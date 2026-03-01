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
import { createApiClient } from "@/lib/api-client"
import type { MovementHistoryEvent } from "@/lib/api-types"

const apiClient = createApiClient({ timeoutMs: 3500, retries: 1 })

const parseMovements = (payload: unknown): { data: MovementHistoryEvent[]; total: number; page: number; pageSize: number } => {
  if (typeof payload !== "object" || payload === null) {
    return { data: [], total: 0, page: 1, pageSize: 20 }
  }

  const data = Array.isArray((payload as { data?: unknown }).data)
    ? ((payload as { data: MovementHistoryEvent[] }).data ?? [])
    : []

  const pagination = (payload as { pagination?: { total?: number; page?: number; pageSize?: number } }).pagination
  return {
    data,
    total: Number(pagination?.total ?? data.length),
    page: Number(pagination?.page ?? 1),
    pageSize: Number(pagination?.pageSize ?? 20),
  }
}

export default function MonitoringPage() {
  const [items, setItems] = useState<MovementHistoryEvent[]>([])
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")

  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    eventType: "all",
    userId: "",
    entityType: "all",
  })

  const totalPages = useMemo(() => Math.max(Math.ceil(total / pageSize), 1), [pageSize, total])

  const loadMovements = async (targetPage: number) => {
    setIsLoading(true)
    setError("")

    const query = new URLSearchParams({
      page: String(targetPage),
      page_size: String(pageSize),
    })

    if (filters.dateFrom) query.set("date_from", filters.dateFrom)
    if (filters.dateTo) query.set("date_to", filters.dateTo)
    if (filters.eventType !== "all") query.set("event_type", filters.eventType)
    if (filters.userId.trim()) query.set("user_id", filters.userId.trim())
    if (filters.entityType !== "all") query.set("entity_type", filters.entityType)

    const response = await apiClient.request<unknown>("GET", `/monitoring/movements?${query.toString()}`)
    if (!response.ok) {
      setItems([])
      setTotal(0)
      setError(response.error ?? "No se pudo cargar el historico de movimientos.")
      setIsLoading(false)
      return
    }

    const parsed = parseMovements(response.data)
    setItems(parsed.data)
    setTotal(parsed.total)
    setPage(parsed.page)
    setIsLoading(false)
  }

  useEffect(() => {
    void loadMovements(1)
  }, [])

  const applyFilters = async () => {
    await loadMovements(1)
  }

  const resetFilters = async () => {
    setFilters({ dateFrom: "", dateTo: "", eventType: "all", userId: "", entityType: "all" })
    setPage(1)
    setTimeout(() => {
      void loadMovements(1)
    }, 0)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Monitoreo</h1>
        <p className="mt-1 text-muted-foreground">Historico de movimientos del sistema</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-5">
          <div className="space-y-2">
            <Label htmlFor="from">Desde</Label>
            <Input
              id="from"
              type="date"
              value={filters.dateFrom}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="to">Hasta</Label>
            <Input
              id="to"
              type="date"
              value={filters.dateTo}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Tipo evento</Label>
            <Select
              value={filters.eventType}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, eventType: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="supplier_create">Proveedor creado</SelectItem>
                <SelectItem value="supplier_update">Proveedor actualizado</SelectItem>
                <SelectItem value="purchase_order_create">OC creada</SelectItem>
                <SelectItem value="purchase_order_approve">OC aprobada</SelectItem>
                <SelectItem value="purchase_order_reject">OC rechazada</SelectItem>
                <SelectItem value="inventory_in">Inventario entrada</SelectItem>
                <SelectItem value="inventory_out">Inventario salida</SelectItem>
                <SelectItem value="finance_payment_create">Pago finanzas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="user">Usuario</Label>
            <Input
              id="user"
              placeholder="ID de usuario"
              value={filters.userId}
              onChange={(event) => setFilters((prev) => ({ ...prev, userId: event.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Entidad</Label>
            <Select
              value={filters.entityType}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, entityType: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="supplier">Proveedor</SelectItem>
                <SelectItem value="purchase_order">Orden de compra</SelectItem>
                <SelectItem value="inventory">Inventario</SelectItem>
                <SelectItem value="finance_payment">Pago</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="md:col-span-5 flex items-center gap-2">
            <Button onClick={applyFilters}>Aplicar filtros</Button>
            <Button variant="outline" onClick={resetFilters}>
              Limpiar
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Eventos</CardTitle>
          <div className="text-sm text-muted-foreground">{total} registros</div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha/Hora</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Accion</TableHead>
                  <TableHead>Entidad</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Cargando movimientos...
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Sin resultados para los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{new Date(item.createdAt).toLocaleString("es-VE")}</TableCell>
                      <TableCell>{item.userName}</TableCell>
                      <TableCell>{item.role}</TableCell>
                      <TableCell>
                        <div className="font-medium">{item.action}</div>
                        <div className="text-xs text-muted-foreground">{item.eventType}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{item.entityType}</div>
                        <div className="text-xs text-muted-foreground">{item.entityId}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.result === "OK" ? "default" : "destructive"}>{item.result}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || isLoading} onClick={() => void loadMovements(page - 1)}>
              Anterior
            </Button>
            <span className="text-sm text-muted-foreground">
              Pagina {page} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isLoading}
              onClick={() => void loadMovements(page + 1)}
            >
              Siguiente
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

