import { timingSafeEqual } from "node:crypto";

import { listAudit, logAudit, logAuthApiEvent, maskEmail, pruneAuditLog, resolveApiActor, verifyAuditChain } from "./audit";
import { auth } from "./auth";
import { prisma } from "./db";
import { sendDataExportEmail, sendSmtpTestEmail, type DataExport, type SmtpConfig } from "./mail";
import { ensureAuthSchema } from "./migrate";
import { startMissedPunchScheduler, updateWorkHoursSchedule, type WorkHoursSchedule } from "./missed-punch";
import { loadAdminEmployees, loadEmployeePunches, loadPortalExport, portalPage, resetPage, setReportVisibility } from "./portal";
import { issuePunchOtp, verifyPunchOtp } from "./punch-otp";
import { configuredPublicOrigin, configuredTrustedOrigins, publicOrigins, runtime } from "./runtime";

await ensureAuthSchema(prisma);

const port = Number(process.env.PORT ?? 3435);
const sharedKey = process.env.PONTUALL_SHARED_KEY ?? "";

/** Constant-time equality that never short-circuits on length. */
function keyMatches(provided: string): boolean {
	const a = Buffer.from(provided);
	const b = Buffer.from(sharedKey);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

// Employees open the emailed password link from their own devices, so the
// listener binds to every interface instead of loopback. /internal routes
// stay gated by the shared key; /api/auth is guarded by Better Auth itself.
// PONTUALL_PUBLIC_URL overrides the auto-detected LAN address in the links.
runtime.publicOrigin = configuredPublicOrigin() ?? publicOrigins(port)[0] ?? null;
runtime.trustedOrigins = configuredTrustedOrigins();

type AdminGate =
	| { ok: true; user: { id: string; name: string | null; email: string | null } }
	| { ok: false; response: Response };

/** Resolves the session and checks the given Better Auth permissions. */
async function requireAdmin(
	request: Request,
	permissions: Record<string, string[]>,
): Promise<AdminGate> {
	let session = null;
	try {
		session = await auth.api.getSession({ headers: request.headers });
	} catch {
		// treated as unauthenticated
	}
	if (!session?.user) {
		return { ok: false, response: Response.json({ error: "não autenticado" }, { status: 401 }) };
	}
	let allowed = false;
	try {
		const result = await auth.api.userHasPermission({
			body: { userId: session.user.id, permissions },
		});
		allowed = Boolean(result?.success);
	} catch {
		allowed = false;
	}
	if (!allowed) {
		return { ok: false, response: Response.json({ error: "acesso negado" }, { status: 403 }) };
	}
	return {
		ok: true,
		user: {
			id: session.user.id,
			name: session.user.name ?? null,
			email: session.user.email ?? null,
		},
	};
}

/** Better Auth role → PontuAll access level, for cosmetic UI gating. */
function accessLevel(role?: string | null): "employee" | "supervisor" | "administrator" {
	const v = (role ?? "employee").toLowerCase();
	if (v.includes("admin")) return "administrator";
	if (v.includes("supervisor")) return "supervisor";
	return "employee";
}

const server = Bun.serve({
	hostname: "0.0.0.0",
	port,
	// These pages and their bundled assets are served by Bun itself and
	// never reach fetch(); everything else goes through the gate below.
	routes: {
		"/portal": portalPage,
		"/reset-password": resetPage,
	},
	async fetch(request, server) {
		const url = new URL(request.url);

		const isAuthApi = url.pathname.startsWith("/api/auth");
		const isHealth = url.pathname === "/health";
		const isPortalData = url.pathname === "/portal/data" && request.method === "GET";
		const isPortalAdmin = url.pathname.startsWith("/portal/admin/");

		// Fail closed: every /internal route requires a valid shared key. An
		// empty key (misconfiguration) rejects rather than opening these
		// privilege-escalation routes. /api/auth is exempt (Better Auth guards
		// it via session + role); /health carries no secrets; /portal/data and
		// /portal/admin/* require a session (checked per-route by requireAdmin).
		if (!isAuthApi && !isHealth && !isPortalData && !isPortalAdmin) {
			if (!sharedKey || !keyMatches(request.headers.get("x-pontuall-key") ?? "")) {
				return new Response("Forbidden", { status: 403 });
			}
		}

		if (isHealth) {
			return Response.json({ ok: true, version: "0.3.1" });
		}

		if (isPortalData) {
			// Self-service data access (LGPD Art. 18, II/V): the session owner
			// only ever sees the employee record linked to their own account.
			let session = null;
			try {
				session = await auth.api.getSession({ headers: request.headers });
			} catch {
				// fall through: treated as unauthenticated
			}
			if (!session?.user) {
				return Response.json({ error: "não autenticado" }, { status: 401 });
			}
			const data = await loadPortalExport(session.user.id);
			if (!data) {
				return Response.json(
					{ error: "nenhum funcionário vinculado a esta conta" },
					{ status: 404 },
				);
			}
			const withRole = { ...(data as object), accessLevel: accessLevel(session.user.role) };
			void logAudit({
				actorId: session.user.id,
				actorName: session.user.name ?? null,
				actorType: "user",
				action: "portal/data-access",
				resource: maskEmail(session.user.email ?? ""),
				success: true,
				ipAddress: server.requestIP(request)?.address ?? null,
				userAgent: request.headers.get("user-agent"),
			});
			return Response.json(withRole);
		}

		if (url.pathname === "/portal/admin/report-visibility" && request.method === "POST") {
			const gate = await requireAdmin(request, { punch: ["delete-others"] });
			if (!gate.ok) return gate.response;
			const body = (await request.json()) as { hidden?: boolean };
			if (typeof body.hidden !== "boolean") {
				return Response.json({ error: "hidden (boolean) obrigatório" }, { status: 400 });
			}
			const affected = await setReportVisibility(gate.user.id, body.hidden);
			void logAudit({
				actorId: gate.user.id,
				actorName: gate.user.name,
				actorType: "admin",
				action: "portal/report-visibility",
				resource: maskEmail(gate.user.email ?? ""),
				success: affected > 0,
				ipAddress: server.requestIP(request)?.address ?? null,
				userAgent: request.headers.get("user-agent"),
				payload: { hidden: body.hidden },
			});
			return Response.json({ ok: true, hidden: body.hidden });
		}

		if (url.pathname === "/portal/admin/employees" && request.method === "GET") {
			const gate = await requireAdmin(request, { punch: ["read-others"] });
			if (!gate.ok) return gate.response;
			const employees = await loadAdminEmployees();
			void logAudit({
				actorId: gate.user.id, actorName: gate.user.name, actorType: "admin",
				action: "portal/admin-employees-list", success: true,
				ipAddress: server.requestIP(request)?.address ?? null,
				userAgent: request.headers.get("user-agent"),
			});
			return Response.json({ employees });
		}

		if (url.pathname === "/portal/admin/punches" && request.method === "GET") {
			const gate = await requireAdmin(request, { punch: ["read-others"] });
			if (!gate.ok) return gate.response;
			const employeeId = url.searchParams.get("employeeId") ?? "";
			if (!employeeId) {
				return Response.json({ error: "employeeId obrigatório" }, { status: 400 });
			}
			const entries = await loadEmployeePunches(employeeId);
			void logAudit({
				actorId: gate.user.id, actorName: gate.user.name, actorType: "admin",
				action: "portal/admin-punch-read", resource: `employee:${employeeId}`,
				success: true, ipAddress: server.requestIP(request)?.address ?? null,
				userAgent: request.headers.get("user-agent"),
			});
			return Response.json({ entries });
		}

		if (url.pathname === "/internal/promote-auth-admin" && request.method === "POST") {
			const body = (await request.json()) as { userId?: string };
			if (!body.userId) {
				return Response.json({ error: "userId required" }, { status: 400 });
			}
			// Bootstrap-only: refuse once any administrator exists, so this
			// session-less route cannot re-promote arbitrary accounts.
			const existingAdmin = await prisma.user.findFirst({
				where: { role: { in: ["administrator", "admin"] } },
				select: { id: true },
			});
			if (existingAdmin && existingAdmin.id !== body.userId) {
				void logAudit({
					actorType: "system",
					action: "internal/promote-auth-admin",
					resource: `user:${body.userId}`,
					success: false,
				});
				return Response.json(
					{ error: "an administrator already exists" },
					{ status: 409 },
				);
			}
			await prisma.user.update({
				where: { id: body.userId },
				data: { role: "administrator" },
			});
			void logAudit({
				actorType: "system",
				action: "internal/promote-auth-admin",
				resource: `user:${body.userId}`,
				success: true,
			});
			return Response.json({ ok: true });
		}

		if (url.pathname === "/internal/user-roles" && request.method === "GET") {
			const users = await prisma.user.findMany({
				select: { id: true, role: true },
			});
			const roles = Object.fromEntries(
				users.map((u) => [u.id, u.role ?? "employee"])
			);
			return Response.json({ roles });
		}

		if (url.pathname === "/internal/set-user-role" && request.method === "POST") {
			const body = (await request.json()) as {
				userId?: string;
				role?: string;
				actorId?: string;
				actorName?: string;
			};
			if (!body.userId || !body.role) {
				return Response.json({ error: "userId and role required" }, { status: 400 });
			}
			await prisma.user.update({
				where: { id: body.userId },
				data: { role: body.role },
			});
			void logAudit({
				actorId: body.actorId ?? null,
				actorName: body.actorName ?? null,
				actorType: body.actorId ? "admin" : "system",
				action: "internal/set-user-role",
				resource: `user:${body.userId}`,
				success: true,
				payload: { role: body.role },
			});
			return Response.json({ ok: true });
		}

		if (url.pathname === "/internal/has-permission" && request.method === "POST") {
			const body = (await request.json()) as {
				userId?: string;
				permissions?: Record<string, string[]>;
			};
			if (!body.userId || !body.permissions) {
				return Response.json({ error: "userId and permissions required" }, { status: 400 });
			}
			const result = await auth.api.userHasPermission({
				body: {
					userId: body.userId,
					permissions: body.permissions,
				},
			});
			return Response.json({ success: Boolean(result?.success) });
		}

		if (url.pathname === "/internal/password-setup/send" && request.method === "POST") {
			const body = (await request.json()) as {
				email?: string;
				smtp?: SmtpConfig;
				publicBaseUrl?: string;
				actorId?: string;
				actorName?: string;
			};
			if (!body.email || !body.smtp) {
				return Response.json({ error: "email and smtp required" }, { status: 400 });
			}
			// Admin-configured base URL (Settings → Avançado) overrides the
			// boot-time default and is trusted as an origin immediately.
			const configured = body.publicBaseUrl?.trim().replace(/\/+$/, "");
			if (configured) {
				runtime.publicOrigin = configured;
			}
			if (!runtime.publicOrigin) {
				return Response.json(
					{ error: "nenhum endereço de rede disponível para montar o link" },
					{ status: 502 },
				);
			}
			// Stash the SMTP config where sendResetPassword (which runs
			// outside this request) can read it.
			runtime.smtp = body.smtp;
			const audit = (success: boolean) =>
				void logAudit({
					actorId: body.actorId ?? null,
					actorName: body.actorName ?? null,
					actorType: body.actorId ? "admin" : "system",
					action: "internal/password-setup-send",
					resource: maskEmail(body.email ?? ""),
					success,
				});
			try {
				await auth.api.requestPasswordReset({ body: { email: body.email } });
				audit(true);
				return Response.json({ ok: true });
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				console.error("[password-setup] send failed:", message);
				audit(false);
				return Response.json({ error: message }, { status: 502 });
			}
		}

		if (url.pathname === "/internal/audit/list" && request.method === "GET") {
			const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
			const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
			return Response.json(await listAudit(limit, offset));
		}

		if (url.pathname === "/internal/audit/verify" && request.method === "GET") {
			return Response.json(await verifyAuditChain());
		}

		if (url.pathname === "/internal/punch-otp/send" && request.method === "POST") {
			const body = (await request.json()) as {
				authUserId?: string;
				email?: string;
				employeeName?: string;
				smtp?: SmtpConfig;
			};
			if (!body.authUserId || !body.email || !body.employeeName || !body.smtp) {
				return Response.json({ error: "missing fields" }, { status: 400 });
			}
			const authSecret = process.env.BETTER_AUTH_SECRET ?? "";
			try {
				await issuePunchOtp(
					prisma,
					body.authUserId,
					body.email,
					body.employeeName,
					body.smtp,
					authSecret,
				);
				return Response.json({ ok: true });
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				console.error("[punch-otp] send failed:", message);
				return Response.json({ error: message }, { status: 502 });
			}
		}

		if (url.pathname === "/internal/punch-otp/verify" && request.method === "POST") {
			const body = (await request.json()) as {
				authUserId?: string;
				code?: string;
			};
			if (!body.authUserId || !body.code) {
				return Response.json({ error: "authUserId and code required" }, { status: 400 });
			}
			const authSecret = process.env.BETTER_AUTH_SECRET ?? "";
			const result = await verifyPunchOtp(
				prisma,
				body.authUserId,
				body.code,
				authSecret,
			);
			if (!result.ok) {
				return Response.json({ ok: false, reason: result.reason }, { status: 401 });
			}
			return Response.json({ ok: true });
		}

		if (url.pathname === "/internal/data-export/send" && request.method === "POST") {
			const body = (await request.json()) as {
				to?: string;
				smtp?: SmtpConfig;
				export?: DataExport;
				actorId?: string;
				actorName?: string;
			};
			if (!body.to || !body.smtp || !body.export) {
				return Response.json({ error: "to, smtp and export required" }, { status: 400 });
			}
			const audit = (success: boolean) =>
				void logAudit({
					actorId: body.actorId ?? null,
					actorName: body.actorName ?? null,
					actorType: body.actorId ? "admin" : "system",
					action: "internal/data-export-send",
					resource: maskEmail(body.to ?? ""),
					success,
				});
			try {
				await sendDataExportEmail(body.smtp, body.to, body.export);
				audit(true);
				return Response.json({ ok: true });
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				console.error("[data-export] send failed:", message);
				audit(false);
				return Response.json({ error: message }, { status: 502 });
			}
		}

		if (url.pathname === "/internal/smtp/push" && request.method === "POST") {
			const body = (await request.json()) as { smtp?: SmtpConfig };
			if (!body.smtp) {
				return Response.json({ error: "smtp required" }, { status: 400 });
			}
			runtime.smtp = body.smtp;
			return Response.json({ ok: true });
		}

		if (url.pathname === "/internal/public-origins/push" && request.method === "POST") {
			const body = (await request.json()) as {
				publicOrigin?: string | null;
				trustedOrigins?: string[];
			};
			if (body.publicOrigin !== undefined) {
				const value = body.publicOrigin?.trim().replace(/\/+$/, "");
				runtime.publicOrigin = value && value.length > 0 ? value : null;
			}
			if (Array.isArray(body.trustedOrigins)) {
				runtime.trustedOrigins = body.trustedOrigins
					.map((o) => o.trim().replace(/\/+$/, ""))
					.filter((o) => o.length > 0);
			}
			return Response.json({ ok: true });
		}

		if (url.pathname === "/internal/work-hours/push" && request.method === "POST") {
			const body = (await request.json()) as { workHours?: WorkHoursSchedule };
			if (!body.workHours) {
				return Response.json({ error: "workHours required" }, { status: 400 });
			}
			updateWorkHoursSchedule(body.workHours);
			return Response.json({ ok: true });
		}

		if (url.pathname === "/internal/smtp/test" && request.method === "POST") {
			const body = (await request.json()) as { smtp?: SmtpConfig; to?: string };
			if (!body.smtp || !body.to) {
				return Response.json({ error: "smtp and to required" }, { status: 400 });
			}
			try {
				await sendSmtpTestEmail(body.smtp, body.to);
				return Response.json({ ok: true });
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				return Response.json({ error: message }, { status: 502 });
			}
		}

		if (isAuthApi) {
			// Audit every mutation and every admin read; get-session and
			// has-permission are polled constantly and would only add noise.
			const shouldLog =
				(request.method === "POST" || url.pathname.includes("/admin/")) &&
				!url.pathname.endsWith("/get-session") &&
				!url.pathname.endsWith("/has-permission");
			if (!shouldLog) {
				return auth.handler(request);
			}

			let payload: Record<string, unknown> = {};
			if (request.method === "POST") {
				try {
					payload = (await request.clone().json()) as Record<string, unknown>;
				} catch {
					// non-JSON body — nothing to capture
				}
			}
			// Resolve the actor before the handler runs: sign-out destroys
			// the very session it acted with.
			const actor = await resolveApiActor(request);
			const response = await auth.handler(request);
			logAuthApiEvent(
				request,
				url.pathname,
				payload,
				actor,
				response.status,
				server.requestIP(request)?.address ?? null,
			);
			return response;
		}

		return new Response("Not Found", { status: 404 });
	},
});

console.log(`pontuall-auth listening on http://127.0.0.1:${server.port}`);

// Daily LGPD retention for the tables this sidecar owns
// (.lgpd/retention.md §3); the Rust side purges its own tables.
const SESSION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const VERIFICATION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function runRetention(): Promise<void> {
	const now = Date.now();
	const sessions = await prisma.session.deleteMany({
		where: { expiresAt: { lt: new Date(now - SESSION_GRACE_MS) } },
	});
	const verifications = await prisma.verification.deleteMany({
		where: { expiresAt: { lt: new Date(now - VERIFICATION_GRACE_MS) } },
	});
	const auditPruned = await pruneAuditLog();
	if (sessions.count > 0 || verifications.count > 0 || auditPruned > 0) {
		void logAudit({
			actorType: "system",
			action: "retention:purge",
			success: true,
			payload: {
				sessions: sessions.count,
				verifications: verifications.count,
				auditPruned,
			},
		});
	}
}

const logRetentionError = (e: unknown) =>
	console.error("[retention] purge failed:", e instanceof Error ? e.message : e);
setTimeout(() => void runRetention().catch(logRetentionError), 60_000);
setInterval(() => void runRetention().catch(logRetentionError), RETENTION_INTERVAL_MS);

startMissedPunchScheduler(() => runtime.smtp);

process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
process.stdin.on("close", () => process.exit(0));
