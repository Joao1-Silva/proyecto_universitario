"use client"

import { useEffect, useMemo, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { createApiClient } from "@/lib/api-client"
import type { Department, InventoryItem, InventoryMovement, Product } from "@/lib/api-types"
import { getPermissions } from "@/lib/permissions"
import { getCurrentUser, useAppStore } from "@/lib/store"

const apiClient = createApiClient({ timeoutMs: 3500, retries: 1 })
const CANONICAL_DEPARTMENT_NAMES = ["Mantenimiento", "Operaciones", "Administracion", "Laborales"] as const
const CANONICAL_DEPARTMENT_ORDER = new Map<string, number>(CANONICAL_DEPARTMENT_NAMES.map((name, index) => [name, index]))

const parseList = <T,>(payload: unknown): T[] => {
  if (typeof payload !== "object" || payload === null) return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data as T[]
}

export default function InventoryPage() {
  const store = useAppStore()
  const permissions = getPermissions(getCurrentUser(store))
  const { toast } = useToast()

  const [items, setItems] = useState<InventoryItem[]>([])
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [outForm, setOutForm] = useState({ productId: "", qty: 0, departmentId: "", reason: "" })

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])
  const departmentById = useMemo(() => new Map(departments.map((dep) => [dep.id, dep])), [departments])

  const loadData = async () => {
    setIsLoading(true)
    setError("")

    const [itemsRes, movRes, depRes, prodRes] = await Promise.all([
      apiClient.request<unknown>("GET", "/inventory/items"),
      apiClient.request<unknown>("GET", "/inventory/movements?page=1&page_size=100"),
      apiClient.request<unknown>("GET", "/departments?only_active=true"),
      apiClient.request<unknown>("GET", "/products?onlyActive=true"),
    ])

    if (!itemsRes.ok && !movRes.ok) {
      setError(itemsRes.error ?? movRes.error ?? "No se pudo cargar inventario.")
      setIsLoading(false)
      return
    }

    if (itemsRes.ok) setItems(parseList<InventoryItem>(itemsRes.data))
    if (movRes.ok) setMovements(parseList<InventoryMovement>(movRes.data))
    if (depRes.ok) {
      const nextDepartments = parseList<Department>(depRes.data)
        .filter((department) => CANONICAL_DEPARTMENT_ORDER.has(department.name))
        .sort(
          (left, right) =>
            (CANONICAL_DEPARTMENT_ORDER.get(left.name) ?? CANONICAL_DEPARTMENT_ORDER.size) -
            (CANONICAL_DEPARTMENT_ORDER.get(right.name) ?? CANONICAL_DEPARTMENT_ORDER.size),
        )
      setDepartments(nextDepartments)
    }
    if (prodRes.ok) setProducts(parseList<Product>(prodRes.data))

    setIsLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  const registerOut = async () => {
    if (!permissions.canManageInventory) return
    if (!outForm.productId || !outForm.departmentId || outForm.qty <= 0 || !outForm.reason.trim()) {
      toast({
        title: "Datos incompletos",
        description: "Producto, departamento, cantidad y motivo son obligatorios para salida.",
        variant: "destructive",
      })
      return
    }

    const response = await apiClient.request<unknown>("POST", "/inventory/movements/out", {
      productId: outForm.productId,
      qty: Number(outForm.qty),
      departmentId: outForm.departmentId,
      reason: outForm.reason,
    })

    if (!response.ok) {
      toast({ title: "No se pudo registrar salida", description: response.error ?? "Intenta nuevamente.", variant: "destructive" })
      return
    }

    toast({ title: "Salida registrada", description: "Movimiento de inventario guardado." })
    setOutForm({ productId: "", qty: 0, departmentId: "", reason: "" })
    await loadData()
  }

  if (!permissions.canViewInventory) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Almacén interno</h1>
          <p className="mt-1 text-muted-foreground">Stock automatico y salidas por departamento</p>
        </div>
        <Alert variant="destructive">
          <AlertDescription>No tienes permisos para ver inventario.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Almacén interno</h1>
        <p className="mt-1 text-muted-foreground">
          Las entradas se generan automaticamente cuando Finanzas registra pagos o abonos. Aqui solo registras salidas.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Registrar salida</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Producto</Label>
            <Select value={outForm.productId} onValueChange={(value) => setOutForm((prev) => ({ ...prev, productId: value }))}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona producto" />
              </SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Departamento destino</Label>
            <Select
              value={outForm.departmentId}
              onValueChange={(value) => setOutForm((prev) => ({ ...prev, departmentId: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona departamento" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Cantidad</Label>
            <Input
              type="number"
              min={0}
              value={outForm.qty}
              onChange={(event) => setOutForm((prev) => ({ ...prev, qty: Number(event.target.value) }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Motivo</Label>
            <Input
              value={outForm.reason}
              onChange={(event) => setOutForm((prev) => ({ ...prev, reason: event.target.value }))}
              placeholder="Obligatorio"
            />
          </div>

          <div className="md:col-span-2">
            <Button onClick={() => void registerOut()} disabled={!permissions.canManageInventory}>
              Registrar salida
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stock actual</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Tipo activo</TableHead>
                  <TableHead>Ubicacion</TableHead>
                  <TableHead>Actualizado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Cargando stock...
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Sin items de inventario.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        {productById.get(item.productId)?.name ?? item.productId}
                        <div className="text-xs text-muted-foreground">{item.productId}</div>
                      </TableCell>
                      <TableCell>{item.stock}</TableCell>
                      <TableCell>{item.assetType}</TableCell>
                      <TableCell>{item.location || "-"}</TableCell>
                      <TableCell>{new Date(item.updatedAt).toLocaleString("es-VE")}</TableCell>
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
          <CardTitle>Movimientos recientes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead>Departamento</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Sin movimientos.
                    </TableCell>
                  </TableRow>
                ) : (
                  movements.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell>{new Date(movement.createdAt).toLocaleString("es-VE")}</TableCell>
                      <TableCell>{movement.type}</TableCell>
                      <TableCell>{productById.get(movement.productId)?.name ?? movement.productId}</TableCell>
                      <TableCell>{movement.qty}</TableCell>
                      <TableCell>{movement.departmentId ? departmentById.get(movement.departmentId)?.name ?? movement.departmentId : "-"}</TableCell>
                      <TableCell>{movement.reason || "-"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
