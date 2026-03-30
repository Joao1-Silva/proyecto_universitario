"use client"

import { useEffect, useMemo, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { createApiClient } from "@/lib/api-client"
import type { FinanceBalanceSummary, FinancePayment, PurchaseOrder, Supplier } from "@/lib/api-types"
import { getPermissions } from "@/lib/permissions"
import { getCurrentUser, useAppStore } from "@/lib/store"

const apiClient = createApiClient({ timeoutMs: 3500, retries: 1 })
const PURCHASE_ORDER_FETCH_PAGE_SIZE = 100

const parseList = <T,>(payload: unknown): T[] => {
  if (typeof payload !== "object" || payload === null) return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data as T[]
}

const parsePaged = <T,>(payload: unknown): { data: T[]; totalPages: number } => {
  if (typeof payload !== "object" || payload === null) return { data: [], totalPages: 1 }
  const data = Array.isArray((payload as { data?: unknown }).data) ? ((payload as { data: T[] }).data ?? []) : []
  const pagination = (payload as { pagination?: { totalPages?: number } }).pagination
  return {
    data,
    totalPages: Math.max(Number(pagination?.totalPages ?? 1), 1),
  }
}

const loadAllPurchaseOrders = async (): Promise<{ ok: boolean; data: PurchaseOrder[]; error?: string }> => {
  const firstResponse = await apiClient.request<unknown>("GET", `/purchase-orders?page=1&pageSize=${PURCHASE_ORDER_FETCH_PAGE_SIZE}`)
  if (!firstResponse.ok) {
    return {
      ok: false,
      data: [],
      error: firstResponse.error ?? "No se pudieron cargar las órdenes de compra.",
    }
  }

  const firstPage = parsePaged<PurchaseOrder>(firstResponse.data)
  const rows = [...firstPage.data]
  if (firstPage.totalPages === 1) return { ok: true, data: rows }

  const pendingPages = Array.from({ length: firstPage.totalPages - 1 }, (_, index) =>
    apiClient.request<unknown>("GET", `/purchase-orders?page=${index + 2}&pageSize=${PURCHASE_ORDER_FETCH_PAGE_SIZE}`),
  )
  const responses = await Promise.all(pendingPages)

  let error: string | undefined
  for (const response of responses) {
    if (!response.ok) {
      error = response.error ?? "No se pudieron cargar todas las órdenes de compra."
      continue
    }
    rows.push(...parsePaged<PurchaseOrder>(response.data).data)
  }

  return {
    ok: error === undefined,
    data: rows,
    error,
  }
}

const formatCurrency = (value: number, currency = "USD") =>
  new Intl.NumberFormat("es-VE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value)

const mapStatusLabel: Record<FinanceBalanceSummary["status"], string> = {
  pending: "Pendiente",
  partial: "Parcial",
  paid: "Pagado",
}

const mapStatusVariant: Record<FinanceBalanceSummary["status"], "secondary" | "outline" | "default"> = {
  pending: "secondary",
  partial: "outline",
  paid: "default",
}

const FINANCE_ELIGIBLE_ORDER_STATUSES = new Set<PurchaseOrder["status"]>(["approved", "certified", "received"])

const buildCreditDueFields = (
  order: PurchaseOrder,
  supplier: Supplier | undefined,
  remainingAmount: number,
): Pick<FinanceBalanceSummary, "creditDays" | "creditDueDate" | "daysUntilCreditDue" | "isDueToday" | "isOverdue"> => {
  const creditDays = Math.max(Number(supplier?.creditDays ?? 0), 0)
  if (creditDays <= 0) {
    return {
      creditDays: 0,
      creditDueDate: null,
      daysUntilCreditDue: null,
      isDueToday: false,
      isOverdue: false,
    }
  }

  const baseDate = order.approvedAt ? new Date(order.approvedAt) : new Date(order.date)
  const dueDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + creditDays)
  const today = new Date()
  const todayAtStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const millisPerDay = 24 * 60 * 60 * 1000
  const daysUntilCreditDue = Math.round((dueDate.getTime() - todayAtStart.getTime()) / millisPerDay)
  const hasPendingBalance = remainingAmount > 0

  return {
    creditDays,
    creditDueDate: dueDate.toISOString().slice(0, 10),
    daysUntilCreditDue,
    isDueToday: hasPendingBalance && daysUntilCreditDue === 0,
    isOverdue: hasPendingBalance && daysUntilCreditDue < 0,
  }
}

const buildLocalSummaries = (orders: PurchaseOrder[], payments: FinancePayment[], suppliers: Supplier[]): FinanceBalanceSummary[] => {
  const paidByOrder = payments.reduce<Record<string, number>>((acc, payment) => {
    acc[payment.purchaseOrderId] = (acc[payment.purchaseOrderId] ?? 0) + Number(payment.amount)
    return acc
  }, {})
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]))

  return orders.map((order) => {
    const totalAmount = Number(order.total)
    const paidAmount = Number((paidByOrder[order.id] ?? 0).toFixed(2))
    const remainingAmount = Number(Math.max(totalAmount - paidAmount, 0).toFixed(2))

    let status: FinanceBalanceSummary["status"] = "pending"
    if (remainingAmount <= 0) status = "paid"
    else if (paidAmount > 0) status = "partial"

    return {
      purchaseOrderId: order.id,
      orderNumber: order.orderNumber,
      supplierName: order.supplierName,
      totalAmount: Number(totalAmount.toFixed(2)),
      paidAmount,
      remainingAmount,
      status,
      currency: "USD",
      ...buildCreditDueFields(order, supplierById.get(order.supplierId), remainingAmount),
    }
  })
}

const formatShortDate = (value?: string | null) => {
  if (!value) return "-"
  return new Date(`${value}T00:00:00`).toLocaleDateString("es-VE")
}

export default function FinanzasPage() {
  const store = useAppStore()
  const permissions = getPermissions(getCurrentUser(store))
  const { toast } = useToast()

  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [payments, setPayments] = useState<FinancePayment[]>([])
  const [summaries, setSummaries] = useState<FinanceBalanceSummary[]>([])

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")

  const [paymentForm, setPaymentForm] = useState({
    purchaseOrderId: "",
    amount: 0,
    paymentType: "contado",
    paymentMode: "transferencia",
    reference: "",
    concept: "",
  })

  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders])
  const supplierById = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers])
  const summaryByOrderId = useMemo(() => new Map(summaries.map((summary) => [summary.purchaseOrderId, summary])), [summaries])
  const eligiblePaymentOrders = useMemo(
    () =>
      orders.filter((order) => {
        if (!FINANCE_ELIGIBLE_ORDER_STATUSES.has(order.status)) return false
        const remainingAmount = summaryByOrderId.get(order.id)?.remainingAmount ?? Number(order.total)
        return remainingAmount > 0
      }),
    [orders, summaryByOrderId],
  )
  const selectedPaymentOrder = useMemo(() => orderById.get(paymentForm.purchaseOrderId), [orderById, paymentForm.purchaseOrderId])
  const selectedPaymentSupplier = useMemo(
    () => (selectedPaymentOrder ? supplierById.get(selectedPaymentOrder.supplierId) : undefined),
    [selectedPaymentOrder, supplierById],
  )
  const selectedPaymentAllowsCredit = (selectedPaymentSupplier?.creditDays ?? 0) > 0
  const selectedPaymentSummary = useMemo(
    () => summaryByOrderId.get(paymentForm.purchaseOrderId),
    [paymentForm.purchaseOrderId, summaryByOrderId],
  )
  const activeSummaries = useMemo(() => summaries.filter((summary) => summary.remainingAmount > 0), [summaries])
  const overdueSummaries = useMemo(() => activeSummaries.filter((summary) => summary.isOverdue), [activeSummaries])
  const dueTodaySummaries = useMemo(() => activeSummaries.filter((summary) => summary.isDueToday), [activeSummaries])

  useEffect(() => {
    if (!paymentForm.purchaseOrderId) return
    if (eligiblePaymentOrders.some((order) => order.id === paymentForm.purchaseOrderId)) return
    setPaymentForm((prev) => ({ ...prev, purchaseOrderId: "", amount: 0, paymentType: "contado" }))
  }, [eligiblePaymentOrders, paymentForm.purchaseOrderId])

  useEffect(() => {
    if (!paymentForm.purchaseOrderId || selectedPaymentAllowsCredit || paymentForm.paymentType === "contado") return
    setPaymentForm((prev) => ({ ...prev, paymentType: "contado" }))
  }, [paymentForm.paymentType, paymentForm.purchaseOrderId, selectedPaymentAllowsCredit])

  useEffect(() => {
    if (!selectedPaymentSummary || paymentForm.paymentType !== "contado") return
    const fixedAmount = Number(selectedPaymentSummary.remainingAmount.toFixed(2))
    if (Number(paymentForm.amount.toFixed(2)) === fixedAmount) return
    setPaymentForm((prev) => ({ ...prev, amount: fixedAmount }))
  }, [paymentForm.amount, paymentForm.paymentType, selectedPaymentSummary])

  const loadData = async () => {
    setIsLoading(true)
    setError("")

    const [ordersRes, suppliersRes, payRes, summaryRes] = await Promise.all([
      loadAllPurchaseOrders(),
      apiClient.request<unknown>("GET", "/suppliers"),
      apiClient.request<unknown>("GET", "/finanzas/pagos"),
      apiClient.request<unknown>("GET", "/finanzas/resumen"),
    ])

    if (!ordersRes.ok && !suppliersRes.ok && !payRes.ok && !summaryRes.ok) {
      setError(ordersRes.error ?? suppliersRes.error ?? payRes.error ?? summaryRes.error ?? "No se pudo cargar finanzas.")
      setIsLoading(false)
      return
    }

    const nextOrders = ordersRes.data
    const nextSuppliers = suppliersRes.ok ? parseList<Supplier>(suppliersRes.data) : []
    const nextPayments = payRes.ok ? parseList<FinancePayment>(payRes.data) : []

    setOrders(nextOrders)
    setSuppliers(nextSuppliers)
    setPayments(nextPayments)

    if (summaryRes.ok) {
      setSummaries(parseList<FinanceBalanceSummary>(summaryRes.data))
    } else {
      setSummaries(buildLocalSummaries(nextOrders, nextPayments, nextSuppliers))
    }

    const loadErrors = [ordersRes.error, suppliersRes.error, payRes.error, summaryRes.error].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    )
    setError(loadErrors[0] ?? "")

    setIsLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  const handlePaymentOrderChange = (value: string) => {
    const order = orderById.get(value)
    const supplier = order ? supplierById.get(order.supplierId) : undefined
    const remainingAmount = summaryByOrderId.get(value)?.remainingAmount ?? 0

    setPaymentForm((prev) => ({
      ...prev,
      purchaseOrderId: value,
      paymentType: (supplier?.creditDays ?? 0) > 0 ? prev.paymentType : "contado",
      amount: Number(remainingAmount.toFixed(2)),
    }))
  }

  const submitPayment = async () => {
    if (!permissions.canManageFinance) return
    if (!paymentForm.purchaseOrderId || paymentForm.amount <= 0) {
      toast({ title: "Datos incompletos", description: "OC y monto son obligatorios.", variant: "destructive" })
      return
    }
    if (!selectedPaymentOrder || !selectedPaymentSupplier || !selectedPaymentSummary) {
      toast({ title: "OC inválida", description: "Selecciona una orden de compra válida con saldo pendiente.", variant: "destructive" })
      return
    }
    if (!FINANCE_ELIGIBLE_ORDER_STATUSES.has(selectedPaymentOrder.status)) {
      toast({ title: "OC no elegible", description: "Solo puedes pagar órdenes aprobadas, certificadas o recibidas.", variant: "destructive" })
      return
    }
    if (paymentForm.amount > selectedPaymentSummary.remainingAmount) {
      toast({ title: "Monto inválido", description: "El pago no puede superar el saldo restante.", variant: "destructive" })
      return
    }
    if (
      paymentForm.paymentType === "contado" &&
      Number(paymentForm.amount.toFixed(2)) !== Number(selectedPaymentSummary.remainingAmount.toFixed(2))
    ) {
      toast({
        title: "Pago completo requerido",
        description: "Los pagos de contado deben registrar el saldo completo de la orden.",
        variant: "destructive",
      })
      return
    }
    if (!selectedPaymentAllowsCredit) {
      if (paymentForm.paymentType !== "contado") {
        toast({ title: "Crédito no permitido", description: "Este proveedor no tiene días de crédito.", variant: "destructive" })
        return
      }
    }

    const response = await apiClient.request<unknown>("POST", "/finanzas/pagos", {
      ...paymentForm,
      currency: "USD",
    })
    if (!response.ok) {
      toast({ title: "No se pudo registrar pago", description: response.error ?? "Intenta nuevamente.", variant: "destructive" })
      return
    }

    toast({ title: "Pago registrado", description: "Pago guardado. El material de la OC ya puede salir desde almacen." })
    setPaymentForm({ purchaseOrderId: "", amount: 0, paymentType: "contado", paymentMode: "transferencia", reference: "", concept: "" })
    await loadData()
  }

  if (!permissions.canViewFinance) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Finanzas</h1>
          <p className="mt-1 text-muted-foreground">Pagos asociados a OC</p>
        </div>
        <Alert variant="destructive">
          <AlertDescription>No tienes permisos para ver finanzas.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Finanzas</h1>
        <p className="mt-1 text-muted-foreground">Pagos enlazados a ordenes de compra en USD. Cada registro habilita el material de la OC en almacen.</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {overdueSummaries.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription className="space-y-1">
            <p className="font-medium">Hay {overdueSummaries.length} orden(es) de compra con deuda vencida.</p>
            {overdueSummaries.slice(0, 4).map((summary) => (
              <p key={summary.purchaseOrderId}>
                {summary.orderNumber} - {summary.supplierName}: venció el {formatShortDate(summary.creditDueDate)} y mantiene saldo de{" "}
                {formatCurrency(summary.remainingAmount, summary.currency)}.
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {dueTodaySummaries.length > 0 && (
        <Alert>
          <AlertDescription className="space-y-1">
            <p className="font-medium">Hay {dueTodaySummaries.length} orden(es) cuyo crédito vence hoy.</p>
            {dueTodaySummaries.slice(0, 4).map((summary) => (
              <p key={summary.purchaseOrderId}>
                {summary.orderNumber} - {summary.supplierName}: vence hoy con saldo pendiente de{" "}
                {formatCurrency(summary.remainingAmount, summary.currency)}.
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Saldo por orden de compra</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>OC</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead className="text-right">Monto total</TableHead>
                  <TableHead className="text-right">Pagado</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">Cargando...</TableCell>
                  </TableRow>
                ) : activeSummaries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">Sin órdenes con saldo pendiente. Las órdenes pagadas ya no se muestran aquí.</TableCell>
                  </TableRow>
                ) : (
                  activeSummaries.map((summary) => (
                    <TableRow key={summary.purchaseOrderId}>
                      <TableCell>{summary.orderNumber}</TableCell>
                      <TableCell>{summary.supplierName}</TableCell>
                      <TableCell className="text-right">{formatCurrency(summary.totalAmount, summary.currency)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(summary.paidAmount, summary.currency)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(summary.remainingAmount, summary.currency)}</TableCell>
                      <TableCell>
                        <Badge variant={mapStatusVariant[summary.status]}>{mapStatusLabel[summary.status]}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registrar pago</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2 md:col-span-2">
            <Label>Orden de compra</Label>
            <Select value={paymentForm.purchaseOrderId} onValueChange={handlePaymentOrderChange}>
              <SelectTrigger disabled={eligiblePaymentOrders.length === 0}>
                <SelectValue placeholder="Selecciona OC" />
              </SelectTrigger>
              <SelectContent>
                {eligiblePaymentOrders.map((order) => (
                  <SelectItem key={order.id} value={order.id}>
                    {order.orderNumber} - {order.supplierName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {eligiblePaymentOrders.length === 0
                ? "No hay órdenes aprobadas/certificadas/recibidas con saldo pendiente."
                : "Solo se muestran órdenes con saldo pendiente listas para gestión financiera."}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Monto (USD)</Label>
            <Input
              type="number"
              min={0}
              value={paymentForm.amount}
              readOnly={paymentForm.paymentType === "contado"}
              onChange={(event) => setPaymentForm((prev) => ({ ...prev, amount: Number(event.target.value) }))}
            />
            <p className="text-xs text-muted-foreground">
              {paymentForm.paymentType === "credito"
                ? "Puedes editar el monto del pago cuando la orden sea a crédito."
                : "En pagos de contado se usa el saldo completo de la orden."}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={paymentForm.paymentType} onValueChange={(value) => setPaymentForm((prev) => ({ ...prev, paymentType: value }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contado">Contado</SelectItem>
                <SelectItem value="credito" disabled={!selectedPaymentAllowsCredit}>
                  Crédito
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Modo</Label>
            <Input value={paymentForm.paymentMode} onChange={(event) => setPaymentForm((prev) => ({ ...prev, paymentMode: event.target.value }))} placeholder="transferencia / efectivo / tarjeta" />
          </div>

          <div className="space-y-2">
            <Label>Referencia</Label>
            <Input value={paymentForm.reference} onChange={(event) => setPaymentForm((prev) => ({ ...prev, reference: event.target.value }))} />
          </div>

          <div className="space-y-2 md:col-span-3">
            <Label>Concepto</Label>
            <Input value={paymentForm.concept} onChange={(event) => setPaymentForm((prev) => ({ ...prev, concept: event.target.value }))} />
          </div>

          {selectedPaymentSummary && (
            <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm md:col-span-3 md:grid-cols-3">
              <p>Saldo restante: {formatCurrency(selectedPaymentSummary.remainingAmount, "USD")}</p>
              <p>Días de crédito: {selectedPaymentSupplier?.creditDays ?? 0}</p>
              <p>{selectedPaymentAllowsCredit ? "Proveedor con crédito: permite pagos parciales." : "Proveedor sin crédito: requiere pago completo."}</p>
            </div>
          )}

          <div className="md:col-span-3">
            <Button onClick={() => void submitPayment()} disabled={!permissions.canManageFinance}>
              Registrar pago
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pagos registrados</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>OC</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Modo</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">Cargando...</TableCell>
                  </TableRow>
                ) : payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">Sin pagos registrados.</TableCell>
                  </TableRow>
                ) : (
                  payments.map((payment) => {
                    const summary = summaryByOrderId.get(payment.purchaseOrderId)
                    return (
                      <TableRow key={payment.id}>
                        <TableCell>{new Date(payment.createdAt).toLocaleString("es-VE")}</TableCell>
                        <TableCell>{orderById.get(payment.purchaseOrderId)?.orderNumber ?? payment.purchaseOrderId}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{payment.paymentType}</Badge>
                        </TableCell>
                        <TableCell>{payment.paymentMode}</TableCell>
                        <TableCell className="text-right">{formatCurrency(payment.amount, payment.currency)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(summary?.remainingAmount ?? 0, "USD")}</TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
