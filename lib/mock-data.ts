import type {
  Supplier,
  PurchaseOrder,
  Invoice,
  Payment,
  BankTransaction,
  AuditLog,
  User,
  CompanySettings,
  LateFeeSettings,
  Category,
  Service,
} from "./api-types"

export const mockCategories: Category[] = [
  { id: "cat-epp-cabeza-cuerpo", name: "Proteccion Personal (EPP - Cabeza y Cuerpo)" },
  { id: "cat-extremidades", name: "Proteccion de Extremidades (Manos y Pies)" },
  { id: "cat-senalizacion-vial", name: "Senalizacion y Seguridad Vial" },
  { id: "cat-escritura-papeleria", name: "Consumibles de Escritura y Papeleria" },
  { id: "cat-impresion-tecnologia", name: "Insumos de Impresion y Tecnologia" },
]

export const mockServices: Service[] = [
  { id: "srv-consultoria", name: "Consultoría", vatRate: 0.16 },
  { id: "srv-mantenimiento", name: "Mantenimiento", vatRate: 0.16 },
]

export const mockSuppliers: Supplier[] = [
  {
    id: "1",
    name: "Aceros del Norte SA",
    rif: "J123456789",
    email: "contacto@acerosnorte.com",
    phone: "+52 555-1234",
    categoryIds: ["cat-epp-cabeza-cuerpo"],
    responsible: "Laura Sánchez",
    status: "active",
    creditDays: 30,
    balance: 58300,
    createdAt: "2024-01-15T10:00:00Z",
  },
  {
    id: "2",
    name: "Distribuidora González",
    rif: "J987654321",
    email: "ventas@distgonzalez.com",
    phone: "+52 555-5678",
    categoryIds: ["cat-escritura-papeleria", "cat-senalizacion-vial"],
    responsible: "María López",
    status: "active",
    creditDays: 45,
    balance: 4392,
    createdAt: "2024-02-01T14:30:00Z",
  },
  {
    id: "3",
    name: "Tecnología Empresarial",
    rif: "J111222333",
    email: "soporte@techemp.com",
    phone: "+52 555-9012",
    categoryIds: ["cat-impresion-tecnologia"],
    responsible: "Carlos Ruiz",
    status: "active",
    creditDays: 30,
    balance: 0,
    createdAt: "2024-01-20T09:15:00Z",
  },
]

export const mockPurchaseOrders: PurchaseOrder[] = [
  {
    id: "1",
    orderNumber: "OC-2024-001",
    supplierId: "1",
    supplierName: "Aceros del Norte SA",
    date: "2024-11-10T10:00:00Z",
    status: "approved",
    items: [
      {
        id: "1",
        description: "Acero inoxidable 304 - 2mm",
        quantity: 100,
        unitPrice: 450,
        total: 45000,
        isService: false,
      },
      {
        id: "2",
        description: "Tornillería industrial M8",
        quantity: 500,
        unitPrice: 15,
        total: 7500,
        isService: false,
      },
      {
        id: "3",
        description: "Servicio de corte y doblado",
        quantity: 1,
        unitPrice: 5000,
        total: 5000,
        isService: true,
        serviceId: "srv-mantenimiento",
      },
    ],
    subtotal: 57500,
    tax: 800,
    total: 58300,
    reason: "Entrega en planta principal",
    createdBy: "Juan Pérez",
    createdAt: "2024-11-10T10:00:00Z",
  },
  {
    id: "2",
    orderNumber: "OC-2024-002",
    supplierId: "2",
    supplierName: "Distribuidora González",
    date: "2024-11-12T14:30:00Z",
    status: "sent",
    items: [
      {
        id: "4",
        description: "Cinta adhesiva industrial",
        quantity: 200,
        unitPrice: 35,
        total: 7000,
        isService: false,
      },
      {
        id: "5",
        description: "Servicio de instalación",
        quantity: 1,
        unitPrice: 1200,
        total: 1200,
        isService: true,
        serviceId: "srv-consultoria",
      },
    ],
    subtotal: 8200,
    tax: 192,
    total: 8392,
    reason: "Entrega en planta principal",
    createdBy: "María López",
    createdAt: "2024-11-12T14:30:00Z",
  },
]

export const mockInvoices: Invoice[] = [
  {
    id: "1",
    invoiceNumber: "FAC-001-2024",
    purchaseOrderId: "1",
    supplierId: "1",
    supplierName: "Aceros del Norte SA",
    issueDate: "2024-11-15T10:00:00Z",
    dueDate: "2024-12-15T10:00:00Z",
    status: "pending",
    amount: 58300,
    paidAmount: 0,
    balance: 58300,
    createdAt: "2024-11-15T10:00:00Z",
  },
  {
    id: "2",
    invoiceNumber: "FAC-002-2024",
    purchaseOrderId: "2",
    supplierId: "2",
    supplierName: "Distribuidora González",
    issueDate: "2024-11-14T14:30:00Z",
    dueDate: "2024-12-29T14:30:00Z",
    status: "partial",
    amount: 8392,
    paidAmount: 4000,
    balance: 4392,
    createdAt: "2024-11-14T14:30:00Z",
  },
]

export const mockPayments: Payment[] = [
  {
    id: "1",
    paymentNumber: "PAG-2024-001",
    invoiceId: "2",
    invoiceNumber: "FAC-002-2024",
    supplierId: "2",
    supplierName: "Distribuidora González",
    date: "2024-11-16T10:00:00Z",
    amount: 4000,
    method: "transfer",
    reference: "SPEI-1234567890",
    status: "completed",
    notes: "Anticipo",
    createdBy: "Juan Pérez",
    createdAt: "2024-11-16T10:00:00Z",
  },
]

export const mockBankTransactions: BankTransaction[] = [
  {
    id: "1",
    date: "2024-11-16T10:00:00Z",
    description: "SPEI Distribuidora González",
    amount: 4000,
    reference: "SPEI-1234567890",
    status: "matched",
    matchedPaymentId: "1",
  },
  {
    id: "2",
    date: "2024-11-17T14:30:00Z",
    description: "Transferencia bancaria",
    amount: 15000,
    reference: "TRANS-9876543210",
    status: "unmatched",
  },
]

export const mockAuditLogs: AuditLog[] = [
  {
    id: "1",
    userId: "1",
    userName: "Juan Pérez",
    action: "create",
    entity: "payment",
    entityId: "1",
    changes: { amount: 4000, invoiceId: "2" },
    timestamp: "2024-11-16T10:00:00Z",
    ipAddress: "192.168.1.100",
  },
  {
    id: "2",
    userId: "2",
    userName: "María López",
    action: "update",
    entity: "supplier",
    entityId: "1",
    changes: { phone: "+52 555-1234-NEW" },
    timestamp: "2024-11-15T14:30:00Z",
    ipAddress: "192.168.1.101",
  },
]

type SeedUser = User & { password: string }

export const mockUsers: SeedUser[] = [
  {
    id: "1",
    email: "juan.perez@empresa.com",
    name: "Juan Pérez",
    role: "admin",
    createdAt: "2024-01-15T10:00:00Z",
    password: "Admin123!",
  },
  {
    id: "2",
    email: "maria.lopez@empresa.com",
    name: "María López",
    role: "finance",
    createdAt: "2024-02-01T14:30:00Z",
    password: "Finance123!",
  },
]

export const mockCompanySettings: CompanySettings = {
  name: "Mi Empresa SA de CV",
  rif: "J000111222",
  address: "Av. Principal 123, Ciudad, Estado",
  phone: "+52 555-1234",
  email: "contacto@miempresa.com",
}

export const mockLateFees: LateFeeSettings = {
  enabled: true,
  percentage: 2.5,
  graceDays: 5,
}
