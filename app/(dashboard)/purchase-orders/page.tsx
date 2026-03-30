"use client"

import { Fragment, useEffect, useMemo, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { CheckCircle2, ClipboardList, Plus, Search, XCircle } from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import { createApiClient } from "@/lib/api-client"
import type { Category, Product, PurchaseOrder, PurchaseOrderItem, Supplier } from "@/lib/api-types"
import { getPermissions } from "@/lib/permissions"
import { getCurrentUser, useAppStore } from "@/lib/store"

const apiClient = createApiClient({ timeoutMs: 4000, retries: 1 })

const todayISO = () => new Date().toISOString().slice(0, 10)

const parseList = <T,>(payload: unknown): T[] => {
  if (typeof payload !== "object" || payload === null) return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data as T[]
}

const parsePaged = <T,>(payload: unknown): { data: T[]; total: number; page: number; pageSize: number } => {
  if (typeof payload !== "object" || payload === null) return { data: [], total: 0, page: 1, pageSize: 20 }
  const data = Array.isArray((payload as { data?: unknown }).data) ? ((payload as { data: T[] }).data ?? []) : []
  const pagination = (payload as { pagination?: { total?: number; page?: number; pageSize?: number } }).pagination
  return {
    data,
    total: Number(pagination?.total ?? data.length),
    page: Number(pagination?.page ?? 1),
    pageSize: Number(pagination?.pageSize ?? 20),
  }
}

const statusLabel: Record<string, string> = {
  draft: "Borrador",
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  certified: "Certificada",
  received: "Recibida",
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("es-VE", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value)

interface DraftItem extends PurchaseOrderItem {
  qtyDraft: number
}

type PurchaseOrderTransitionAction = "submit" | "approve" | "reject" | "certify" | "receive"

type ReasonDialogState =
  | { kind: "reject"; order: PurchaseOrder }
  | { kind: "remove-item"; orderId: string; itemId: string }

export default function PurchaseOrdersPage() {
  const store = useAppStore()
  const currentUser = getCurrentUser(store)
  const permissions = getPermissions(currentUser)
  const { toast } = useToast()

  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState("")

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [selectedSupplierId, setSelectedSupplierId] = useState("")
  const [orderDate, setOrderDate] = useState(todayISO())
  const [orderReason, setOrderReason] = useState("")
  const [selectedCategoryId, setSelectedCategoryId] = useState("all")
  const [productSearch, setProductSearch] = useState("")
  const [itemDrafts, setItemDrafts] = useState<Record<string, DraftItem>>({})

  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)
  const [reasonDialogState, setReasonDialogState] = useState<ReasonDialogState | null>(null)
  const [reasonInput, setReasonInput] = useState("")
  const [isReasonActionPending, setIsReasonActionPending] = useState(false)

  const totalPages = Math.max(Math.ceil(total / pageSize), 1)

  const loadPage = async (targetPage: number) => {
    setIsLoading(true)
    setLoadError("")

    const [ordersResponse, suppliersResponse, categoriesResponse, productsResponse] = await Promise.all([
      apiClient.request<unknown>("GET", `/purchase-orders?page=${targetPage}&pageSize=${pageSize}`),
      apiClient.request<unknown>("GET", "/suppliers"),
      apiClient.request<unknown>("GET", "/categories"),
      apiClient.request<unknown>("GET", "/products"),
    ])

    if (!ordersResponse.ok) {
      setLoadError(ordersResponse.error ?? "No se pudo cargar órdenes de compra.")
      setIsLoading(false)
      return
    }

    const paged = parsePaged<PurchaseOrder>(ordersResponse.data)
    setOrders(paged.data)
    setTotal(paged.total)
    setPage(paged.page)

    if (suppliersResponse.ok) setSuppliers(parseList<Supplier>(suppliersResponse.data))
    if (categoriesResponse.ok) setCategories(parseList<Category>(categoriesResponse.data))
    if (productsResponse.ok) setProducts(parseList<Product>(productsResponse.data))

    setIsLoading(false)
  }

  useEffect(() => {
    void loadPage(1)
  }, [])

  const selectedSupplier = suppliers.find((supplier) => supplier.id === selectedSupplierId)
  const selectedSupplierCategoryIds = useMemo(() => new Set(selectedSupplier?.categoryIds ?? []), [selectedSupplier])

  const availableCategories = useMemo(() => {
    if (!selectedSupplier || selectedSupplierCategoryIds.size === 0) return []
    return categories.filter((category) => selectedSupplierCategoryIds.has(category.id))
  }, [categories, selectedSupplier, selectedSupplierCategoryIds])

  const filteredProducts = useMemo(() => {
    if (!selectedSupplier) return []
    const term = productSearch.trim().toLowerCase()
    return products.filter((product) => {
      if (!selectedSupplierCategoryIds.has(product.categoryId)) return false
      if (selectedCategoryId !== "all" && product.categoryId !== selectedCategoryId) return false
      if (!term) return true
      return product.name.toLowerCase().includes(term) || (product.description ?? "").toLowerCase().includes(term)
    })
  }, [productSearch, products, selectedCategoryId, selectedSupplier, selectedSupplierCategoryIds])
  const selectedItems = Object.values(itemDrafts).filter((item) => item.qtyDraft > 0)
  const orderSubtotal = selectedItems.reduce((sum, item) => sum + item.unitPrice * item.qtyDraft, 0)

  useEffect(() => {
    if (selectedCategoryId === "all") return
    if (availableCategories.some((category) => category.id === selectedCategoryId)) return
    setSelectedCategoryId("all")
  }, [availableCategories, selectedCategoryId])

  const openCreate = () => {
    setSelectedSupplierId("")
    setOrderDate(todayISO())
    setOrderReason("")
    setSelectedCategoryId("all")
    setProductSearch("")
    setItemDrafts({})
    setIsCreateDialogOpen(true)
  }

  const handleSupplierChange = (supplierId: string) => {
    setSelectedSupplierId(supplierId)
    setSelectedCategoryId("all")
    setProductSearch("")
    setItemDrafts({})
  }

  const setItemQty = (product: Product, qty: number) => {
    const safeQty = Math.max(Number.isFinite(qty) ? qty : 0, 0)
    setItemDrafts((prev) => ({
      ...prev,
      [product.id]: {
        id: `draft_${product.id}`,
        productId: product.id,
        description: product.name,
        categoryId: product.categoryId,
        quantity: safeQty,
        qtyDraft: safeQty,
        unit: product.unit,
        unitPrice: 0,
        total: 0,
      },
    }))
  }

  const setItemPrice = (product: Product, price: number) => {
    const safePrice = Math.max(Number.isFinite(price) ? price : 0, 0)
    setItemDrafts((prev) => {
      const current = prev[product.id] ?? {
        id: `draft_${product.id}`,
        productId: product.id,
        description: product.name,
        categoryId: product.categoryId,
        quantity: 0,
        qtyDraft: 0,
        unit: product.unit,
        unitPrice: 0,
        total: 0,
      }
      return {
        ...prev,
        [product.id]: {
          ...current,
          unitPrice: safePrice,
        },
      }
    })
  }

  const createOrder = async () => {
    if (!permissions.canCreatePurchaseOrders) return

    if (!selectedSupplierId) {
      toast({ title: "Proveedor requerido", description: "Selecciona un proveedor.", variant: "destructive" })
      return
    }
    if (orderDate < todayISO()) {
      toast({ title: "Fecha inválida", description: "No se permiten fechas pasadas.", variant: "destructive" })
      return
    }

    const payloadItems = selectedItems
      .filter((item) => item.qtyDraft > 0 && item.unitPrice >= 0)
      .map((item) => ({
        productId: item.productId,
        description: item.description,
        quantity: item.qtyDraft,
        unit: item.unit,
        unitPrice: item.unitPrice,
        categoryId: item.categoryId,
      }))

    if (payloadItems.length === 0) {
      toast({ title: "Items requeridos", description: "Agrega al menos un item con cantidad.", variant: "destructive" })
      return
    }

    const response = await apiClient.request<unknown>("POST", "/purchase-orders", {
      supplierId: selectedSupplierId,
      date: orderDate,
      reason: orderReason || null,
      items: payloadItems,
    })

    if (!response.ok) {
      toast({ title: "No se pudo crear la OC", description: response.error ?? "Intenta nuevamente.", variant: "destructive" })
      return
    }

    toast({ title: "OC creada", description: "Orden registrada en estado borrador." })
    setIsCreateDialogOpen(false)
    await loadPage(1)
  }

  const closeReasonDialog = () => {
    setReasonDialogState(null)
    setReasonInput("")
  }

  const runTransition = async (
    order: PurchaseOrder,
    action: PurchaseOrderTransitionAction,
    payload?: Record<string, unknown>,
  ) => {
    const response = await apiClient.request<unknown>("POST", `/purchase-orders/${order.id}/${action}`, payload)
    if (!response.ok) {
      toast({ title: "Operación fallida", description: response.error ?? "No se pudo actualizar la OC.", variant: "destructive" })
      return
    }

    toast({ title: "OC actualizada", description: `Transición ejecutada: ${action}.` })
    await loadPage(page)
    return true
  }

  const removeItemBySuperadmin = async (orderId: string, itemId: string, reason: string) => {
    const response = await apiClient.request<unknown>("POST", `/purchase-orders/${orderId}/items/${itemId}/remove`, {
      reason,
    })
    if (!response.ok) {
      toast({ title: "No se pudo remover item", description: response.error ?? "Intenta nuevamente.", variant: "destructive" })
      return
    }

    toast({ title: "Item removido", description: "El cambio quedó registrado en histórico de movimientos." })
    await loadPage(page)
    return true
  }

  const requestTransition = async (order: PurchaseOrder, action: PurchaseOrderTransitionAction) => {
    if (action === "reject") {
      setReasonInput("")
      setReasonDialogState({ kind: "reject", order })
      return
    }

    await runTransition(order, action, action === "approve" ? {} : undefined)
  }

  const requestRemoveItemBySuperadmin = (orderId: string, itemId: string) => {
    setReasonInput("")
    setReasonDialogState({ kind: "remove-item", orderId, itemId })
  }

  const submitReasonAction = async () => {
    if (!reasonDialogState) return

    const reason = reasonInput.trim()
    if (!reason) {
      toast({ title: "Motivo requerido", description: "Debes indicar un motivo.", variant: "destructive" })
      return
    }

    setIsReasonActionPending(true)
    try {
      const ok =
        reasonDialogState.kind === "reject"
          ? await runTransition(reasonDialogState.order, "reject", { reason })
          : await removeItemBySuperadmin(reasonDialogState.orderId, reasonDialogState.itemId, reason)

      if (ok) closeReasonDialog()
    } finally {
      setIsReasonActionPending(false)
    }
  }

  const canAct = {
    submit: permissions.canSubmitPurchaseOrders,
    approve: permissions.canApprovePurchaseOrders,
    reject: permissions.canRejectPurchaseOrders,
    certify: permissions.canCertifyPurchaseOrders,
    receive: permissions.canReceivePurchaseOrders,
    removeItem: permissions.canRemovePurchaseOrderItems,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Órdenes de Compra</h1>
          <p className="mt-1 text-muted-foreground">
            Flujo DRAFT &gt; PENDIENTE &gt; APROBADA/RECHAZADA &gt; CERTIFICADA &gt; RECIBIDA
          </p>
        </div>

        <Button onClick={openCreate} disabled={!permissions.canCreatePurchaseOrders}>
          <Plus className="mr-2 h-4 w-4" />
          Nueva OC
        </Button>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>OC</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Cargando órdenes...
                    </TableCell>
                  </TableRow>
                ) : orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No hay órdenes registradas.
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((order) => (
                    <Fragment key={order.id}>
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">{order.orderNumber}</TableCell>
                        <TableCell>{order.supplierName}</TableCell>
                        <TableCell>{new Date(order.date).toLocaleDateString("es-VE")}</TableCell>
                        <TableCell>
                          <Badge variant={order.status === "rejected" ? "destructive" : "secondary"}>
                            {statusLabel[order.status] ?? order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(order.total)}</TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setExpandedOrderId((prev) => (prev === order.id ? null : order.id))}
                            >
                              Detalle
                            </Button>

                            {order.status === "draft" && canAct.submit && (
                              <Button variant="outline" size="sm" onClick={() => void requestTransition(order, "submit")}>
                                Enviar
                              </Button>
                            )}
                            {order.status === "pending" && canAct.approve && (
                              <Button size="sm" onClick={() => void requestTransition(order, "approve")}>
                                Aprobar
                              </Button>
                            )}
                            {order.status === "pending" && canAct.reject && (
                              <Button variant="destructive" size="sm" onClick={() => void requestTransition(order, "reject")}>
                                Rechazar
                              </Button>
                            )}
                            {order.status === "approved" && canAct.certify && (
                              <Button variant="outline" size="sm" onClick={() => void requestTransition(order, "certify")}>
                                Certificar
                              </Button>
                            )}
                            {order.status === "certified" && canAct.receive && (
                              <Button variant="outline" size="sm" onClick={() => void requestTransition(order, "receive")}>
                                Recibir
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {expandedOrderId === order.id && (
                        <TableRow key={`${order.id}_detail`}>
                          <TableCell colSpan={6}>
                            <div className="space-y-3 rounded-md border bg-muted/30 p-4">
                              <div className="grid gap-2 md:grid-cols-2">
                                <div>
                                  <p className="text-xs text-muted-foreground">Motivo</p>
                                  <p className="text-sm">{order.reason || "Sin motivo"}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Motivo rechazo</p>
                                  <p className="text-sm">{order.rejectionReason || "N/A"}</p>
                                </div>
                              </div>

                              <div className="rounded-md border bg-background">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Item</TableHead>
                                      <TableHead>Cantidad</TableHead>
                                      <TableHead>Unidad</TableHead>
                                      <TableHead>Precio</TableHead>
                                      <TableHead>Total</TableHead>
                                      <TableHead>Estado</TableHead>
                                      <TableHead className="text-right">Acción</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {order.items.map((item) => (
                                      <TableRow key={item.id}>
                                        <TableCell>
                                          <div className="font-medium">{item.description}</div>
                                          <div className="text-xs text-muted-foreground">{item.productId || "sin productId"}</div>
                                        </TableCell>
                                        <TableCell>{item.quantity}</TableCell>
                                        <TableCell>{item.unit || "-"}</TableCell>
                                        <TableCell>{formatCurrency(item.unitPrice)}</TableCell>
                                        <TableCell>{formatCurrency(item.total)}</TableCell>
                                        <TableCell>
                                          {item.removedBySuperadmin ? (
                                            <Badge variant="destructive">Removido</Badge>
                                          ) : (
                                            <Badge variant="outline">Activo</Badge>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                          {!item.removedBySuperadmin && canAct.removeItem && (order.status === "pending" || order.status === "approved") ? (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() => requestRemoveItemBySuperadmin(order.id, item.id)}
                                            >
                                              Remover
                                            </Button>
                                          ) : null}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => void loadPage(page - 1)}>
              Anterior
            </Button>
            <span className="text-sm text-muted-foreground">
              Página {page} de {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => void loadPage(page + 1)}>
              Siguiente
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Nueva Orden de Compra</DialogTitle>
            <DialogDescription>
              Selecciona proveedor, fecha (sin fechas pasadas) y materiales típicos por categoría con cantidades y precios.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Proveedor</Label>
              <Select value={selectedSupplierId} onValueChange={handleSupplierChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona proveedor" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedSupplier && (
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>RIF: {selectedSupplier.rif}</p>
                  <p>Categorías: {availableCategories.map((category) => category.name).join(", ") || "Sin categorías"}</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="oc-date">Fecha</Label>
              <Input id="oc-date" type="date" min={todayISO()} value={orderDate} onChange={(event) => setOrderDate(event.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="oc-reason">Motivo</Label>
              <Input id="oc-reason" value={orderReason} onChange={(event) => setOrderReason(event.target.value)} placeholder="Opcional" />
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                Selección de categoría
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Categoría</Label>
                  <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
                    <SelectTrigger disabled={!selectedSupplier || availableCategories.length === 0}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      {availableCategories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="product-search">Buscar material</Label>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="product-search"
                      value={productSearch}
                      onChange={(event) => setProductSearch(event.target.value)}
                      className="pl-8"
                      disabled={!selectedSupplier}
                      placeholder="Nombre o descripción"
                    />
                  </div>
                </div>
              </div>

              <div className="max-h-72 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto típico</TableHead>
                      <TableHead>Unidad</TableHead>
                      <TableHead>Cantidad</TableHead>
                      <TableHead>Precio unitario</TableHead>
                      <TableHead className="text-right">Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!selectedSupplier ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          Selecciona un proveedor para ver productos según sus categorías.
                        </TableCell>
                      </TableRow>
                    ) : filteredProducts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          {availableCategories.length === 0
                            ? "El proveedor no tiene categorías asignadas."
                            : "Sin productos para las categorías o filtros seleccionados."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredProducts.map((product) => {
                        const draft = itemDrafts[product.id]
                        const qty = draft?.qtyDraft ?? 0
                        const unitPrice = draft?.unitPrice ?? 0
                        return (
                          <TableRow key={product.id}>
                            <TableCell>
                              <div className="font-medium">{product.name}</div>
                              <div className="text-xs text-muted-foreground">{product.description || "Sin descripción"}</div>
                            </TableCell>
                            <TableCell>{product.unit}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                value={qty}
                                onChange={(event) => setItemQty(product, Number(event.target.value))}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={unitPrice}
                                onChange={(event) => setItemPrice(product, Number(event.target.value))}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              {qty > 0 ? <CheckCircle2 className="inline h-4 w-4 text-emerald-600" /> : <XCircle className="inline h-4 w-4 text-muted-foreground" />}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p>Items seleccionados: {selectedItems.length}</p>
                <p>Subtotal estimado: {formatCurrency(orderSubtotal)}</p>
              </div>
            </CardContent>
          </Card>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void createOrder()}>Crear OC</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={reasonDialogState !== null}
        onOpenChange={(open) => {
          if (!open && !isReasonActionPending) closeReasonDialog()
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!isReasonActionPending}>
          <DialogHeader>
            <DialogTitle>{reasonDialogState?.kind === "remove-item" ? "Remover item" : "Rechazar orden"}</DialogTitle>
            <DialogDescription>
              {reasonDialogState?.kind === "remove-item"
                ? "Indica el motivo obligatorio para remover el item seleccionado."
                : "Indica el motivo obligatorio para rechazar la orden de compra."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="purchase-order-action-reason">Motivo</Label>
            <Textarea
              id="purchase-order-action-reason"
              value={reasonInput}
              onChange={(event) => setReasonInput(event.target.value)}
              placeholder="Escribe el motivo"
              rows={4}
              disabled={isReasonActionPending}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeReasonDialog} disabled={isReasonActionPending}>
              Cancelar
            </Button>
            <Button
              variant={reasonDialogState?.kind === "remove-item" ? "outline" : "destructive"}
              onClick={() => void submitReasonAction()}
              disabled={isReasonActionPending}
            >
              {isReasonActionPending ? "Procesando..." : reasonDialogState?.kind === "remove-item" ? "Confirmar remocion" : "Confirmar rechazo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

