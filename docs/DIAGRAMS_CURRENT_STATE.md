# DIAGRAMS (CURRENT STATE)

These diagrams represent the current implementation in this repository as of 2026-02-10.

## 1. Payment Registration Sequence (Current)

```mermaid
sequenceDiagram
    actor U as Usuario
    participant UI as PaymentDialog (Frontend)
    participant ST as store.applyPayment()
    participant LS as localStorage (AppStore)

    U->>UI: Captura datos del pago
    UI->>ST: applyPayment(input)

    ST->>ST: Buscar invoice por invoiceId
    alt Factura no existe
        ST-->>UI: ok=false, error="Factura no encontrada"
        UI-->>U: Mostrar error
    else Factura existe
        ST->>ST: Validar monto > 0 y <= saldo
        alt Monto invalido
            ST-->>UI: ok=false, error de validacion
            UI-->>U: Mostrar error
        else Monto valido
            ST->>ST: Validar referencia no vacia
            alt Referencia vacia
                ST-->>UI: ok=false, error de validacion
                UI-->>U: Mostrar error
            else Datos validos
                ST->>LS: updateStore()\n- crear payment\n- actualizar invoice\n- crear audit log
                LS-->>ST: OK
                ST-->>UI: ok=true, payment
                UI-->>U: Confirmacion "Pago registrado"
            end
        end
    end
```

Notes:
- Payment registration currently runs in frontend local state (`lib/store.ts`), not in backend `/payments`.
- Backend route `GET /payments` exists, but payment write endpoints are still pending.

## 2. Backend ER Diagram (Current)

```mermaid
erDiagram
    SUPPLIERS {
        string id PK
        string name
        string rfc
        string email
        string phone
        json category_ids
        string responsible
        string status
        int credit_days
        float balance
        datetime created_at
    }

    PURCHASE_ORDERS {
        string id PK
        string order_number
        string supplier_id
        string supplier_name
        datetime date
        string status
        json items
        float subtotal
        float tax
        float total
        text reason
        string created_by
        datetime created_at
    }

    INVOICES {
        string id PK
        string invoice_number
        string purchase_order_id
        string supplier_id
        string supplier_name
        datetime issue_date
        datetime due_date
        string status
        float amount
        float paid_amount
        float balance
        datetime created_at
    }

    PAYMENTS {
        string id PK
        string payment_number
        string invoice_id
        string invoice_number
        string supplier_id
        string supplier_name
        datetime date
        float amount
        string method
        string reference
        string status
        text proof_url
        text notes
        string created_by
        datetime created_at
    }

    BANK_TRANSACTIONS {
        string id PK
        datetime date
        text description
        float amount
        string reference
        string status
        string matched_payment_id
    }

    AUDIT_LOGS {
        string id PK
        string user_id
        string user_name
        string action
        string entity
        string entity_id
        json changes
        datetime timestamp
        string ip_address
    }

    USERS {
        string id PK
        string email
        string name
        string role
        datetime created_at
        string password
    }

    COMPANY_SETTINGS {
        string id PK
        string name
        string rfc
        text address
        string phone
        string email
        text logo
    }

    LATE_FEES {
        string id PK
        bool enabled
        float percentage
        int grace_days
    }

    SUPPLIERS ||--o{ PURCHASE_ORDERS : supplier_id
    SUPPLIERS ||--o{ INVOICES : supplier_id
    SUPPLIERS ||--o{ PAYMENTS : supplier_id
    PURCHASE_ORDERS ||--o{ INVOICES : purchase_order_id
    INVOICES ||--o{ PAYMENTS : invoice_id
    PAYMENTS ||--o{ BANK_TRANSACTIONS : matched_payment_id
    USERS ||--o{ AUDIT_LOGS : user_id
```

Notes:
- Relationships are logical references by id fields in models.
- The current SQLAlchemy models do not define explicit `ForeignKey(...)` constraints.

## 3. Backend Class Diagram (Current)

```mermaid
classDiagram
    class SupplierModel {
        +id: str
        +name: str
        +rfc: str
        +email: str
        +phone: str
        +category_ids: list[str]
        +responsible: str
        +status: str
        +credit_days: int
        +balance: float
        +created_at: datetime
    }

    class PurchaseOrderModel {
        +id: str
        +order_number: str
        +supplier_id: str
        +supplier_name: str
        +date: datetime
        +status: str
        +items: list[dict]
        +subtotal: float
        +tax: float
        +total: float
        +reason: str?
        +created_by: str
        +created_at: datetime
    }

    class InvoiceModel {
        +id: str
        +invoice_number: str
        +purchase_order_id: str
        +supplier_id: str
        +supplier_name: str
        +issue_date: datetime
        +due_date: datetime
        +status: str
        +amount: float
        +paid_amount: float
        +balance: float
        +created_at: datetime
    }

    class PaymentModel {
        +id: str
        +payment_number: str
        +invoice_id: str
        +invoice_number: str
        +supplier_id: str
        +supplier_name: str
        +date: datetime
        +amount: float
        +method: str
        +reference: str
        +status: str
        +proof_url: str?
        +notes: str?
        +created_by: str
        +created_at: datetime
    }

    class BankTransactionModel {
        +id: str
        +date: datetime
        +description: str
        +amount: float
        +reference: str
        +status: str
        +matched_payment_id: str?
    }

    class AuditLogModel {
        +id: str
        +user_id: str
        +user_name: str
        +action: str
        +entity: str
        +entity_id: str
        +changes: dict
        +timestamp: datetime
        +ip_address: str
    }

    class UserModel {
        +id: str
        +email: str
        +name: str
        +role: str
        +created_at: datetime
        +password: str
    }

    class CompanySettingsModel {
        +id: str
        +name: str
        +rfc: str
        +address: str
        +phone: str
        +email: str
        +logo: str?
    }

    class LateFeeModel {
        +id: str
        +enabled: bool
        +percentage: float
        +grace_days: int
    }

    SupplierModel "1" --> "0..*" PurchaseOrderModel : supplier_id
    SupplierModel "1" --> "0..*" InvoiceModel : supplier_id
    SupplierModel "1" --> "0..*" PaymentModel : supplier_id
    PurchaseOrderModel "1" --> "0..*" InvoiceModel : purchase_order_id
    InvoiceModel "1" --> "0..*" PaymentModel : invoice_id
    PaymentModel "1" --> "0..*" BankTransactionModel : matched_payment_id
    UserModel "1" --> "0..*" AuditLogModel : user_id
```

Notes:
- These classes mirror `backend/app/models.py`.
- ORM relationship attributes are not declared; links are by ids.
