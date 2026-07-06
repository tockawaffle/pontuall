import { Label } from "@/components/ui/label";
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger} from "@/components/ui/dialog";
import {Avatar, AvatarFallback} from "@/components/ui/avatar";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import React, {useEffect, useState} from "react";
import TauriApi from "@/lib/Tauri";
import {SpinnerIcon} from "@/components/component/icons";
import {canEditPunches, ACCESS_LEVEL_LABELS, normalizeAccessLevel, type PontuallAccessLevel} from "@/lib/pontuall-permissions";
import {toast} from "sonner";

type EmployeesProps = {
    filteredEmployees: Users,
    setSelectedDate: React.Dispatch<React.SetStateAction<string>>,
    selectedDate: string,
    selectedEmployee: IUsers | null,
    setUsers: React.Dispatch<React.SetStateAction<Users | []>>
    GetData: (id: string) => void,
    setSelectedEmployee: React.Dispatch<React.SetStateAction<IUsers | null>>,
    capabilities: SessionCapabilities | null
}

type EditUserForm = {
    name: string,
    email: string,
    role: string,
    lunchTime: string,
    phone: string,
    accessLevel: PontuallAccessLevel,
}

function lunchTimeForInput(value?: string): string {
    if (!value) return "";
    const parts = value.split(":");
    if (parts.length >= 2) {
        return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
    }
    return value;
}

function lunchTimeForSave(value: string): string {
    if (!value.trim()) return "";
    return value.length === 5 ? `${value}:00` : value;
}

function accessRoleToLevel(accessRole?: string | null): PontuallAccessLevel {
    return normalizeAccessLevel(accessRole ?? "employee");
}

function employeeToEditForm(employee: IUsers): EditUserForm {
    return {
        name: employee.name,
        email: employee.email ?? "",
        role: employee.role,
        lunchTime: lunchTimeForInput(employee.lunch_time),
        phone: employee.phone ?? "",
        accessLevel: accessRoleToLevel(employee.access_role),
    };
}

const EMPTY_HOUR_DATA: HourData = {
    clock_in: "",
    lunch_break_out: "",
    lunch_break_return: "",
    clocked_out: "",
    total_hours: "",
};

export default function Employees(
    {
        filteredEmployees,
        setSelectedDate,
        selectedDate,
        selectedEmployee,
        setUsers,
        GetData,
        setSelectedEmployee,
        capabilities
    }: EmployeesProps
) {

    const [enableEdit, setEnableEdit] = useState(true);
    const [hourData, setHourData] = useState<HourData>(EMPTY_HOUR_DATA);
    const [updateMessage, setUpdateMessage] = useState<{
        type: string,
        message: string
    }>({
        type: "",
        message: ""
    });
    const [sortedDates, setSortedDates] = useState<string[]>([]);
    const [editUserModal, setEditUserModal] = useState(false);
    const [editUserForm, setEditUserForm] = useState<EditUserForm | null>(null);
    const [savingProfile, setSavingProfile] = useState(false);
    const [deleteDayLoading, setDeleteDayLoading] = useState(false);
    const [cardModalOpen, setCardModalOpen] = useState(false);
    const [cardProvisioning, setCardProvisioning] = useState(false);

    useEffect(() => {
        if (!selectedEmployee || selectedDate === "") {
            setHourData(EMPTY_HOUR_DATA);
            return;
        }
        const data = selectedEmployee.hour_data?.[selectedDate];
        setHourData(data ?? EMPTY_HOUR_DATA);
    }, [selectedDate, selectedEmployee]);

    function openEditUserModal() {
        if (!selectedEmployee) return;
        setEditUserForm(employeeToEditForm(selectedEmployee));
        setEditUserModal(true);
    }

    async function refreshUsers() {
        const data = await TauriApi.GetCache();
        const users = Object.values(data) as Users;
        setUsers(users);
    }

    async function handleSaveProfile() {
        if (!selectedEmployee || !editUserForm) return;

        const name = editUserForm.name.trim();
        if (!name) {
            toast.error("Informe o nome do funcionário.");
            return;
        }

        setSavingProfile(true);
        try {
            await TauriApi.UpdateEmployee(
                selectedEmployee.id,
                name,
                editUserForm.email,
                editUserForm.role.trim(),
                lunchTimeForSave(editUserForm.lunchTime),
                editUserForm.phone,
                editUserForm.accessLevel,
            );
            await refreshUsers();
            GetData(selectedEmployee.id);
            setEditUserModal(false);
            toast.success("Dados do funcionário atualizados.");
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            toast.error(message || "Não foi possível atualizar o funcionário.");
        } finally {
            setSavingProfile(false);
        }
    }

    async function HandleEdit() {
        if (!selectedEmployee?.hour_data?.[selectedDate]) {
            return;
        }

        // Check the keys that were modified
        const modifiedKeys = Object.keys(hourData).filter((key) => {
            // @ts-ignore
            return selectedEmployee.hour_data[selectedDate][key] !== hourData[key]
        });

        // Validate if keys are valid
        if (modifiedKeys.length === 0) {
            return
        }

        // Check if the values modified are empty and if they are, set as N/A
        modifiedKeys.forEach((key) => {
            // @ts-ignore
            if (hourData[key] === "") {
                // @ts-ignore
                hourData[key] = "N/A"
            }
        });

        enum Keys {
            ClockIn = "ClockIn",
            ClockLunchOut = "ClockLunchOut",
            ClockLunchReturn = "ClockLunchReturn",
            ClockOut = "ClockOut"
        }

        let updatedBools: boolean[] = [];
        for (const key of modifiedKeys) {
            let keyToUpdate: Keys;
            switch (key) {
                case "clock_in":
                    keyToUpdate = Keys.ClockIn;
                    break;
                case "lunch_break_out":
                    keyToUpdate = Keys.ClockLunchOut;
                    break;
                case "lunch_break_return":
                    keyToUpdate = Keys.ClockLunchReturn;
                    break;
                case "clocked_out":
                    keyToUpdate = Keys.ClockOut;
                    break;
                default:
                    keyToUpdate = Keys.ClockIn;
                    break;
            }

            try {
                //@ts-ignore: This works, trust me. It's just a type error.
                const update = await TauriApi.UpdateUser(selectedEmployee!.id, selectedDate, keyToUpdate, hourData[key])
                updatedBools.push(update)
            } catch (e) {
                console.error(e)
                updatedBools.push(false)
            }
        }

        // Check if all updates were successful
        if (updatedBools.every((bool) => bool)) {
            // Update the cache
            setUsers((prev) => {
                return prev.map((user) => {
                    if (user.id === selectedEmployee!.id) {
                        return {
                            ...user,
                            hour_data: {
                                ...user.hour_data,
                                [selectedDate]: hourData
                            }
                        }
                    }
                    return user
                })
            })

            const readableKeys = {
                "clock_in": "Entrada",
                "lunch_break_out": "Horário de Almoço - Saída",
                "lunch_break_return": "Horário de Almoço - Retorno",
                "clocked_out": "Saída"
            }

            const keys = modifiedKeys.map((key) => {
                //@ts-ignore: This works, trust me. It's just a type error.
                return readableKeys[key]
            })

            // Set a message with the keys that were updated
            setUpdateMessage({
                type: "success",
                message: `Dados atualizados com sucesso: ${keys.join(", ")}`
            })
            setEnableEdit(true);
        } else {
            setUpdateMessage({
                type: "error",
                message: `Algum dos dados não puderam ser atualizados.`
            })
        }
    }

    async function handleReprovisionCard() {
        if (!selectedEmployee) return;
        setCardProvisioning(true);
        try {
            await TauriApi.ReprovisionCard(selectedEmployee.id);
            toast.success("Novo cartão vinculado", {
                description: `Os cartões anteriores de ${selectedEmployee.name} foram bloqueados.`,
            });
            setCardModalOpen(false);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            toast.error(message || "Não foi possível vincular o novo cartão.");
        } finally {
            setCardProvisioning(false);
        }
    }

    function closeCardModal() {
        if (cardProvisioning) {
            void TauriApi.CancelCard().catch(() => undefined);
        }
        setCardModalOpen(false);
        setCardProvisioning(false);
    }

    const editPerms = capabilities ? canEditPunches(capabilities) : false;
    const editHierarchy = capabilities?.hierarchyManage ?? false;
    const canProvisionCard = capabilities?.cardProvision ?? false;

    const hasDayData = Boolean(
        selectedEmployee &&
        selectedDate !== "" &&
        selectedEmployee.hour_data?.[selectedDate]
    );

    async function handleDeleteDay() {
        if (!selectedEmployee || selectedDate === "" || !hasDayData) return;

        setDeleteDayLoading(true);
        try {
            await TauriApi.DeleteTimeEntryDay(selectedEmployee.id, selectedDate);
            const {[selectedDate]: _removed, ...restHourData} = selectedEmployee.hour_data;
            const updatedEmployee = {...selectedEmployee, hour_data: restHourData};
            setUsers((prev) =>
                prev.map((user) =>
                    user.id === selectedEmployee.id ? updatedEmployee : user
                )
            );
            setSelectedEmployee(updatedEmployee);
            setSelectedDate("");
            setHourData(EMPTY_HOUR_DATA);
            setEnableEdit(true);
            setUpdateMessage({type: "", message: ""});
            toast.success(`Pontos de ${selectedDate} excluídos.`);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            toast.error(message || "Não foi possível excluir os pontos do dia.");
        } finally {
            setDeleteDayLoading(false);
        }
    }

    useEffect(() => {
        if (selectedEmployee) {
            const sortedDates = Object.keys(selectedEmployee.hour_data)
                .map(date => {
                    const [day, month, year] = date.split('/');
                    return new Date(`${year}-${month}-${day}T00:00:00`);
                })
                // @ts-ignore: This works, trust me.
                .sort((a, b) => a - b)
                .map(date => {
                    const day = String(date.getUTCDate()).padStart(2, '0');
                    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                    const year = date.getUTCFullYear();
                    return `${day}/${month}/${year}`;
                })
                .filter(date => date !== "Invalid Date")
                .reverse();
            setSortedDates(sortedDates);
        }
    }, [selectedEmployee])

    return (
        <>
            <Label htmlFor={"worker-list"}>
                Funcionários
                {
                    filteredEmployees.length > 0 && ` (${filteredEmployees.length})`
                }
            </Label>
            {
                filteredEmployees.length === 0 ? (
                    <p className="text-muted-foreground">Nenhum funcionário encontrado.</p>
                ) : (
                    filteredEmployees
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((employee, index) => (
                            <div key={employee.id}>
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <button key={employee.id} onClick={() => {
                                            GetData(employee.id)
                                        }}
                                                className="bg-muted rounded-lg p-4 flex items-center justify-between w-[500px] max-w-[580px]">
                                            <div className="flex items-center gap-2">
                                                <Avatar className="border">
                                                    <AvatarFallback>{employee.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div className={"flex flex-col items-start"}>
                                                    <div className="font-medium">{employee.name}</div>
                                                    <div
                                                        className="text-sm text-muted-foreground">{employee.role}</div>
                                                </div>
                                            </div>
                                        </button>
                                    </DialogTrigger>
                                    <DialogContent onInteractOutside={() => {
                                        // Reset data
                                        setSelectedDate("")
                                        setUpdateMessage({
                                            type: "",
                                            message: ""
                                        })
                                        setHourData(EMPTY_HOUR_DATA)
                                    }}>
                                        <DialogHeader>
                                            <div className="flex items-center gap-4">
                                                <Avatar className="border">
                                                    <AvatarFallback>{employee.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div className={"flex flex-col items-start"}>
                                                    <div className="font-medium">{employee.name}</div>
                                                    <div
                                                        className="text-sm text-muted-foreground">{employee.role}</div>
                                                </div>
                                            </div>
                                        </DialogHeader>
                                        {
                                            !selectedEmployee ? (
                                                <p className={"text-muted-foreground"}>
                                                    Nada encontrado. . .
                                                </p>
                                            ) : (
                                                <div key={index} className="grid gap-4 w-full mt-2">
                                                    <Label htmlFor={"date-selector"}>
                                                        Selecione a data
                                                    </Label>
                                                    <Select onValueChange={(value) => setSelectedDate(value)}>
                                                        <SelectTrigger>
                                                            <SelectValue
                                                                placeholder="Selecione uma Data"/>
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {
                                                                sortedDates.length === 0 ? (
                                                                    <SelectItem value="no-data" disabled>
                                                                        Nenhum dado encontrado
                                                                    </SelectItem>
                                                                ) : sortedDates.map((date, index) => (
                                                                    <SelectItem value={date} key={index}>
                                                                        {date}
                                                                    </SelectItem>
                                                                ))
                                                            }
                                                        </SelectContent>
                                                    </Select>
                                                    {
                                                        updateMessage.type !== "" && (
                                                            <div
                                                                className={`p-2 rounded-lg bg-${updateMessage.type} text-white`}>
                                                                {updateMessage.message}
                                                            </div>
                                                        )
                                                    }
                                                    {
                                                        selectedDate !== "" && (
                                                            <Card
                                                                className={"max-h-[256px] min-w-[256px] overflow-y-auto custom-scrollbar"}>
                                                                <CardHeader>
                                                                    <CardTitle className={"font-normal text-xl"}>
                                                                        Pontos Batidos
                                                                    </CardTitle>
                                                                    <CardDescription>
                                                                        Dia {selectedDate}
                                                                    </CardDescription>
                                                                </CardHeader>
                                                                <CardContent className="space-y-2">
                                                                    <div key={selectedDate}
                                                                         className="grid gap-2">
                                                                        <div>
                                                                            <Label htmlFor="clock-in">
                                                                                Entrada
                                                                            </Label>
                                                                            <Input id="clock-in"
                                                                                   readOnly={enableEdit}
                                                                                   onChange={(e) => {
                                                                                       setHourData({
                                                                                           ...hourData,
                                                                                           clock_in: e.target.value
                                                                                       })
                                                                                   }}
                                                                                   value={
                                                                                       hourData.clock_in
                                                                                   }/>
                                                                        </div>
                                                                        <div>
                                                                            <Label
                                                                                htmlFor="lunch-break">
                                                                                Horário de Almoço - Saída
                                                                            </Label>
                                                                            <Input id="lunch-break"
                                                                                   readOnly={enableEdit}
                                                                                   onChange={(e) => {
                                                                                       setHourData({
                                                                                           ...hourData,
                                                                                           lunch_break_out: e.target.value
                                                                                       })
                                                                                   }}
                                                                                   value={hourData.lunch_break_out}/>
                                                                        </div>
                                                                        <div>
                                                                            <Label htmlFor="lunch-break">
                                                                                Horário de Almoço - Retorno
                                                                            </Label>
                                                                            <Input id="lunch-break"
                                                                                   readOnly={enableEdit}
                                                                                   onChange={(e) => {
                                                                                       setHourData({
                                                                                           ...hourData,
                                                                                           lunch_break_return: e.target.value
                                                                                       })
                                                                                   }}
                                                                                   value={hourData.lunch_break_return}/>
                                                                        </div>
                                                                        <div>
                                                                            <Label htmlFor="clock-out">
                                                                                Saída
                                                                            </Label>
                                                                            <Input id="clock-out"
                                                                                   readOnly={enableEdit}
                                                                                   onChange={(e) => {
                                                                                       setHourData({
                                                                                           ...hourData,
                                                                                           clocked_out: e.target.value
                                                                                       })
                                                                                   }}
                                                                                   value={hourData.clocked_out}/>
                                                                        </div>
                                                                        <div>
                                                                            <Label htmlFor="total-hours">
                                                                                Total de Horas
                                                                            </Label>
                                                                            <Input id="total-hours"
                                                                                   readOnly
                                                                                   value={hourData.total_hours}/>
                                                                        </div>
                                                                    </div>
                                                                </CardContent>
                                                            </Card>
                                                        )
                                                    }
                                                </div>
                                            )
                                        }
                                        <DialogFooter>
                                            <div className={"flex w-full flex-wrap items-center justify-between gap-2"}>
                                                <div className="flex flex-wrap gap-2">
                                                    <Button
                                                        variant="default"
                                                        disabled={selectedDate === "" || !editPerms}
                                                        onClick={() => {
                                                            setEnableEdit(!enableEdit)
                                                        }}
                                                    >
                                                        Editar
                                                    </Button>
                                                    {
                                                        !enableEdit && (
                                                            <Button
                                                                variant="default"
                                                                onClick={() => {
                                                                    HandleEdit()
                                                                }}
                                                            >
                                                                Salvar
                                                            </Button>
                                                        )
                                                    }
                                                    {editHierarchy && (
                                                        <Button
                                                            variant="secondary"
                                                            onClick={openEditUserModal}
                                                        >
                                                            Editar perfil
                                                        </Button>
                                                    )}
                                                    {canProvisionCard && (
                                                        <Button
                                                            variant="secondary"
                                                            onClick={() => setCardModalOpen(true)}
                                                        >
                                                            Novo cartão
                                                        </Button>
                                                    )}
                                                </div>
                                                {editPerms && (
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button
                                                                variant="destructive"
                                                                disabled={
                                                                    !hasDayData ||
                                                                    deleteDayLoading ||
                                                                    !enableEdit
                                                                }
                                                            >
                                                                Excluir dia
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>
                                                                    Excluir pontos do dia?
                                                                </AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    Isso remove todos os registros de{" "}
                                                                    <strong>{selectedDate}</strong> para{" "}
                                                                    <strong>{selectedEmployee?.name}</strong>.
                                                                    Esta ação não pode ser desfeita.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                                <AlertDialogAction
                                                                    variant="destructive"
                                                                    disabled={deleteDayLoading}
                                                                    onClick={() => void handleDeleteDay()}
                                                                >
                                                                    {deleteDayLoading ? "Excluindo…" : "Excluir dia"}
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                )}
                                            </div>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        ))
                )
            }
            <Dialog
                open={cardModalOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        closeCardModal();
                        return;
                    }
                    setCardModalOpen(true);
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Novo cartão</DialogTitle>
                    </DialogHeader>
                    {cardProvisioning ? (
                        <div className="flex flex-col items-center gap-4 py-4 text-center">
                            <p className="text-sm">
                                Aproxime um cartão em branco do leitor para vincular a{" "}
                                <strong>{selectedEmployee?.name}</strong>.
                            </p>
                            <SpinnerIcon className="h-16 w-16 animate-spin"/>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            Vincula um novo cartão NFC a{" "}
                            <strong>{selectedEmployee?.name}</strong>. Os cartões anteriores
                            serão bloqueados e deixarão de bater ponto — use para substituir um
                            cartão perdido ou danificado.
                        </p>
                    )}
                    <DialogFooter>
                        {cardProvisioning ? (
                            <Button
                                variant="outline"
                                onClick={() => {
                                    void TauriApi.CancelCard().catch(() => undefined);
                                    setCardProvisioning(false);
                                }}
                            >
                                Cancelar leitura
                            </Button>
                        ) : (
                            <>
                                <Button variant="outline" onClick={closeCardModal}>
                                    Cancelar
                                </Button>
                                <Button onClick={() => void handleReprovisionCard()}>
                                    Ler novo cartão
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={editUserModal}
                onOpenChange={(open) => {
                    setEditUserModal(open);
                    if (!open) setEditUserForm(null);
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Editar perfil</DialogTitle>
                    </DialogHeader>
                    {editUserForm && (
                        <div className="grid gap-4 py-2">
                            <div>
                                <Label htmlFor="edit-name">Nome</Label>
                                <Input
                                    id="edit-name"
                                    type="text"
                                    value={editUserForm.name}
                                    onChange={(e) =>
                                        setEditUserForm({...editUserForm, name: e.target.value})
                                    }
                                />
                            </div>
                            <div>
                                <Label htmlFor="edit-email">E-mail</Label>
                                <Input
                                    id="edit-email"
                                    type="email"
                                    value={editUserForm.email}
                                    onChange={(e) =>
                                        setEditUserForm({...editUserForm, email: e.target.value})
                                    }
                                />
                            </div>
                            <div>
                                <Label htmlFor="edit-role">Cargo</Label>
                                <Input
                                    id="edit-role"
                                    type="text"
                                    value={editUserForm.role}
                                    onChange={(e) =>
                                        setEditUserForm({...editUserForm, role: e.target.value})
                                    }
                                />
                            </div>
                            <div>
                                <Label htmlFor="edit-lunch-time">Horário de almoço</Label>
                                <Input
                                    id="edit-lunch-time"
                                    type="time"
                                    value={editUserForm.lunchTime}
                                    onChange={(e) =>
                                        setEditUserForm({...editUserForm, lunchTime: e.target.value})
                                    }
                                />
                            </div>
                            <div>
                                <Label htmlFor="edit-phone">Telefone</Label>
                                <Input
                                    id="edit-phone"
                                    type="tel"
                                    value={editUserForm.phone}
                                    onChange={(e) =>
                                        setEditUserForm({...editUserForm, phone: e.target.value})
                                    }
                                />
                            </div>
                            <div>
                                <Label htmlFor="edit-access-level">Nível de acesso</Label>
                                <Select
                                    value={editUserForm.accessLevel}
                                    onValueChange={(value: PontuallAccessLevel) =>
                                        setEditUserForm({...editUserForm, accessLevel: value})
                                    }
                                >
                                    <SelectTrigger id="edit-access-level">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(Object.keys(ACCESS_LEVEL_LABELS) as PontuallAccessLevel[]).map(
                                            (level) => (
                                                <SelectItem key={level} value={level}>
                                                    {ACCESS_LEVEL_LABELS[level]}
                                                </SelectItem>
                                            )
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setEditUserModal(false)}
                            disabled={savingProfile}
                        >
                            Cancelar
                        </Button>
                        <Button onClick={handleSaveProfile} disabled={savingProfile || !editUserForm}>
                            {savingProfile ? "Salvando…" : "Salvar"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
