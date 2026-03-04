"use client"

import { useEffect, useMemo, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { createApiClient } from "@/lib/api-client"
import { getPermissions } from "@/lib/permissions"
import { getCurrentUser, useAppStore } from "@/lib/store"

const apiClient = createApiClient({ timeoutMs: 4500, retries: 1 })

type ReportType = "movement-history" | "finanzas" | "purchase-orders" | "inventory-movements"

const REPORT_LABEL: Record<ReportType, string> = {
  "movement-history": "Histórico de movimientos",
  finanzas: "Reporte de finanzas",
  "purchase-orders": "Órdenes de compra",
  "inventory-movements": "Movimientos de inventario",
}

interface ReportPayload {
  title: string
  reportType: string
  columns: Array<{ key: string; label: string }>
  rows: Array<Record<string, unknown>>
  totals: Record<string, unknown>
  filters: Record<string, unknown>
}

const parseReport = (payload: unknown): ReportPayload | null => {
  if (typeof payload !== "object" || payload === null) return null
  const data = (payload as { data?: unknown }).data
  if (typeof data !== "object" || data === null) return null
  return data as ReportPayload
}

export default function ReportsPage() {
  const store = useAppStore()
  const permissions = getPermissions(getCurrentUser(store))

  const [reportType, setReportType] = useState<ReportType>("movement-history")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [report, setReport] = useState<ReportPayload | null>(null)

  const canViewReports = useMemo(
    () => permissions.canViewReports || permissions.canViewMonitoring || permissions.canViewFinance || permissions.canViewInventory,
    [permissions],
  )

  const runReport = async () => {
    setIsLoading(true)
    setError("")

    const params = new URLSearchParams()
    if (startDate) params.set("startDate", startDate)
    if (endDate) params.set("endDate", endDate)

    const response = await apiClient.request<unknown>("GET", `/reports/${reportType}?${params.toString()}`)
    if (!response.ok) {
      setReport(null)
      setError(response.error ?? "No se pudo generar reporte.")
      setIsLoading(false)
      return
    }

    const parsed = parseReport(response.data)
    if (!parsed) {
      setReport(null)
      setError("Respuesta inválida del backend.")
      setIsLoading(false)
      return
    }

    setReport(parsed)
    setIsLoading(false)
  }

  useEffect(() => {
    if (canViewReports) {
      void runReport()
    }
  }, [reportType])

  const downloadPdf = async () => {
    const response = await apiClient.request<unknown>("POST", `/reports/${reportType}/pdf`, {
      startDate: startDate || null,
      endDate: endDate || null,
    })
    if (!response.ok) {
      setError(response.error ?? "No se pudo generar PDF.")
      return
    }

    const data = (response.data as { data?: { contentBase64?: string } } | undefined)?.data
    if (!data?.contentBase64) {
      setError("PDF vacio.")
      return
    }

    const tab = window.open()
    if (tab) {
      tab.document.write(`<iframe width="100%" height="100%" src="data:application/pdf;base64,${data.contentBase64}"></iframe>`)
    }
  }

  if (!canViewReports) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Reportes</h1>
          <p className="mt-1 text-muted-foreground">Exportación de reportes operativos y financieros</p>
        </div>
        <Alert variant="destructive">
          <AlertDescription>No tienes permisos para ver reportes.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Reportes</h1>
        <p className="mt-1 text-muted-foreground">Genera reportes y exporta en PDF</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Parámetros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={reportType} onValueChange={(value) => setReportType(value as ReportType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="movement-history">{REPORT_LABEL["movement-history"]}</SelectItem>
                <SelectItem value="finanzas">{REPORT_LABEL.finanzas}</SelectItem>
                <SelectItem value="purchase-orders">{REPORT_LABEL["purchase-orders"]}</SelectItem>
                <SelectItem value="inventory-movements">{REPORT_LABEL["inventory-movements"]}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Desde</Label>
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Hasta</Label>
            <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>

          <div className="flex items-end gap-2">
            <Button onClick={() => void runReport()} disabled={isLoading}>
              Consultar
            </Button>
            <Button variant="outline" onClick={() => void downloadPdf()} disabled={isLoading}>
              PDF
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
        <CardHeader>
          <CardTitle>{report?.title ?? REPORT_LABEL[reportType]}</CardTitle>
        </CardHeader>
        <CardContent>
          {!report ? (
            <div className="text-sm text-muted-foreground">Sin datos para mostrar.</div>
          ) : (
            <>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {report.columns.map((column) => (
                        <TableHead key={column.key}>{column.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={Math.max(report.columns.length, 1)} className="text-center text-muted-foreground">
                          Sin resultados.
                        </TableCell>
                      </TableRow>
                    ) : (
                      report.rows.map((row, index) => (
                        <TableRow key={index}>
                          {report.columns.map((column) => (
                            <TableCell key={`${index}_${column.key}`}>{String(row[column.key] ?? "-")}</TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {Object.entries(report.totals).map(([key, value]) => (
                  <div key={key} className="rounded border p-2 text-sm">
                    <span className="font-medium">{key}: </span>
                    <span>{String(value)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

