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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { createApiClient } from "@/lib/api-client"
import type { FinanceInstallment, FinancePayment, PurchaseOrder } from "@/lib/api-types"
import { getPermissions } from "@/lib/permissions"
import { getCurrentUser, useAppStore } from "@/lib/store"

const apiClient = createApiClient({ timeoutMs: 3500, retries: 1 })

const parseList = <T,>(payload: unknown): T[] => {
  if (typeof payload !== "object" || payload === null) return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data as T[]
}

const formatCurrency = (value: number, currency = "VES") =>
  new Intl.NumberFormat("es-VE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value)

export default function FinanzasPage() {
  const store = useAppStore()
  const permissions = getPermissions(getCurrentUser(store))
  const { toast } = useToast()

  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [payments, setPayments] = useState<FinancePayment[]>([])
  const [installments, setInstallments] = useState<FinanceInstallment[]>([])

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")

  const [paymentForm, setPaymentForm] = useState({
    purchaseOrderId: "",
    amount: 0,
    currency: "VES",
    paymentType: "contado",
    paymentMode: "transferencia",
    reference: "",
    concept: "",
  })

  const [installmentForm, setInstallmentForm] = useState({
    purchaseOrderId: "",
    amount: 0,
    currency: "VES",
    concept: "",
  })


  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders])

  const loadData = async () => {
    setIsLoading(true)
    setError("")

    const [ordersRes, payRes, insRes] = await Promise.all([
      apiClient.request<unknown>("GET", "/purchase-orders?page=1&pageSize=200"),
      apiClient.request<unknown>("GET", "/finanzas/pagos"),
      apiClient.request<unknown>("GET", "/finanzas/abonos"),
    ])

    if (!ordersRes.ok && !payRes.ok) {
      setError(ordersRes.error ?? payRes.error ?? "No se pudo cargar finanzas.")
      setIsLoading(false)
      return
    }

    if (ordersRes.ok) {
      const data = parseList<PurchaseOrder>(ordersRes.data)
      setOrders(data.filter((order) => ["approved", "certified", "received"].includes(order.status)))
    }
    if (payRes.ok) setPayments(parseList<FinancePayment>(payRes.data))
    if (insRes.ok) setInstallments(parseList<FinanceInstallment>(insRes.data))

    setIsLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  const submitPayment = async () => {
    if (!permissions.canManageFinance) return
    if (!paymentForm.purchaseOrderId || paymentForm.amount <= 0) {
      toast({ title: "Datos incompletos", description: "OC y monto son obligatorios.", variant: "destructive" })
      return
    }

    const response = await apiClient.request<unknown>("POST", "/finanzas/pagos", paymentForm)
    if (!response.ok) {
      toast({ title: "No se pudo registrar pago", description: response.error ?? "Intenta nuevamente.", variant: "destructive" })
      return
    }

    toast({ title: "Pago registrado", description: "Pago guardado correctamente." })
    setPaymentForm({ purchaseOrderId: "", amount: 0, currency: "VES", paymentType: "contado", paymentMode: "transferencia", reference: "", concept: "" })
    await loadData()
  }

  const submitInstallment = async () => {
    if (!permissions.canManageFinance) return
    if (!installmentForm.purchaseOrderId || installmentForm.amount <= 0) {
      toast({ title: "Datos incompletos", description: "OC y monto son obligatorios.", variant: "destructive" })
      return
    }

    const response = await apiClient.request<unknown>("POST", "/finanzas/abonos", installmentForm)
    if (!response.ok) {
      toast({ title: "No se pudo registrar abono", description: response.error ?? "Intenta nuevamente.", variant: "destructive" })
      return
    }

    toast({ title: "Abono registrado", description: "Abono guardado correctamente." })
    setInstallmentForm({ purchaseOrderId: "", amount: 0, currency: "VES", concept: "" })
    await loadData()
  }

  if (!permissions.canViewFinance) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Finanzas</h1>
          <p className="mt-1 text-muted-foreground">Pagos y abonos asociados a OC</p>
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
        <p className="mt-1 text-muted-foreground">Pagos y abonos enlazados exclusivamente a ordenes de compra</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="pagos" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pagos">Pagos</TabsTrigger>
          <TabsTrigger value="abonos">Abonos</TabsTrigger>
        </TabsList>

        <TabsContent value="pagos" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Registrar pago</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label>Orden de compra</Label>
                <Select value={paymentForm.purchaseOrderId} onValueChange={(value) => setPaymentForm((prev) => ({ ...prev, purchaseOrderId: value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona OC" />
                  </SelectTrigger>
                  <SelectContent>
                    {orders.map((order) => (
                      <SelectItem key={order.id} value={order.id}>
                        {order.orderNumber} - {order.supplierName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Monto</Label>
                <Input type="number" min={0} value={paymentForm.amount} onChange={(event) => setPaymentForm((prev) => ({ ...prev, amount: Number(event.target.value) }))} />
              </div>

              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={paymentForm.paymentType} onValueChange={(value) => setPaymentForm((prev) => ({ ...prev, paymentType: value }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contado">Contado</SelectItem>
                    <SelectItem value="credito">Credito</SelectItem>
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">Cargando...</TableCell>
                      </TableRow>
                    ) : payments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">Sin pagos registrados.</TableCell>
                      </TableRow>
                    ) : (
                      payments.map((payment) => (
                        <TableRow key={payment.id}>
                          <TableCell>{new Date(payment.createdAt).toLocaleString("es-VE")}</TableCell>
                          <TableCell>{orderById.get(payment.purchaseOrderId)?.orderNumber ?? payment.purchaseOrderId}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{payment.paymentType}</Badge>
                          </TableCell>
                          <TableCell>{payment.paymentMode}</TableCell>
                          <TableCell className="text-right">{formatCurrency(payment.amount, payment.currency)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="abonos" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Registrar abono</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label>Orden de compra</Label>
                <Select value={installmentForm.purchaseOrderId} onValueChange={(value) => setInstallmentForm((prev) => ({ ...prev, purchaseOrderId: value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona OC" />
                  </SelectTrigger>
                  <SelectContent>
                    {orders.map((order) => (
                      <SelectItem key={order.id} value={order.id}>
                        {order.orderNumber} - {order.supplierName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Monto</Label>
                <Input type="number" min={0} value={installmentForm.amount} onChange={(event) => setInstallmentForm((prev) => ({ ...prev, amount: Number(event.target.value) }))} />
              </div>

              <div className="space-y-2 md:col-span-3">
                <Label>Concepto</Label>
                <Input value={installmentForm.concept} onChange={(event) => setInstallmentForm((prev) => ({ ...prev, concept: event.target.value }))} />
              </div>

              <div className="md:col-span-3">
                <Button onClick={() => void submitInstallment()} disabled={!permissions.canManageFinance}>
                  Registrar abono
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Abonos registrados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>OC</TableHead>
                      <TableHead>Concepto</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {installments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">Sin abonos registrados.</TableCell>
                      </TableRow>
                    ) : (
                      installments.map((installment) => (
                        <TableRow key={installment.id}>
                          <TableCell>{new Date(installment.createdAt).toLocaleString("es-VE")}</TableCell>
                          <TableCell>{orderById.get(installment.purchaseOrderId)?.orderNumber ?? installment.purchaseOrderId}</TableCell>
                          <TableCell>{installment.concept || "-"}</TableCell>
                          <TableCell className="text-right">{formatCurrency(installment.amount, installment.currency)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  )
}
