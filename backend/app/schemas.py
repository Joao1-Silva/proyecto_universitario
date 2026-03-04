from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


def _apply_aliases(values: object, canonical: str, aliases: tuple[str, ...]) -> object:
    if not isinstance(values, dict):
        return values

    normalized = dict(values)
    if canonical in normalized:
        return normalized

    for alias in aliases:
        if alias in normalized:
            normalized[canonical] = normalized[alias]
            break

    return normalized


def normalize_rif_value(value: str | None) -> str:
    raw = (value or "").strip().upper()
    if not raw:
        return ""

    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) < 9:
        digits = digits.rjust(9, "0")
    if len(digits) > 9:
        digits = digits[:9]

    return f"J-{digits[:8]}-{digits[8]}"


def normalize_country_code(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw:
        return "+58"
    if not raw.startswith("+"):
        raw = f"+{raw}"
    return raw


def normalize_phone_number(value: str | None) -> str:
    return "".join(ch for ch in (value or "") if ch.isdigit())


def sanitize_phone_e164(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    sanitized = re.sub(r"[\s\-\(\)\.]", "", raw)
    if not sanitized:
        return ""
    if sanitized.count("+") > 1:
        return sanitized
    if "+" in sanitized and not sanitized.startswith("+"):
        return sanitized
    if not sanitized.startswith("+"):
        sanitized = f"+{sanitized}"
    return sanitized


def normalize_phone_e164(country_code: str | None, phone_number: str | None, explicit_e164: str | None = None) -> str:
    explicit = sanitize_phone_e164(explicit_e164)
    if explicit:
        return explicit
    cc = normalize_country_code(country_code)
    number = normalize_phone_number(phone_number)
    if not number:
        return ""
    return f"{cc}{number}"


EMAIL_REGEX = re.compile(r"^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$", re.IGNORECASE)
RIF_REGEX = re.compile(r"^J-\d{8}-\d$")
E164_REGEX = re.compile(r"^\+[1-9]\d{7,14}$")


def validate_email_value(value: str) -> str:
    normalized = value.strip().lower()
    if not EMAIL_REGEX.fullmatch(normalized):
        raise ValueError("Email inválido.")
    return normalized


def validate_rif_normalized(value: str) -> str:
    if not RIF_REGEX.fullmatch(value):
        raise ValueError("RIF inválido. Formato esperado: J-########-#.")
    return value


def validate_phone_e164(value: str) -> str:
    if not E164_REGEX.fullmatch(value):
        raise ValueError("Teléfono inválido. Debe cumplir formato E.164.")
    return value


def normalize_currency_usd(value: str | None) -> str:
    normalized = (value or "").strip().upper() or "USD"
    if normalized != "USD":
        raise ValueError("La moneda admitida es USD.")
    return "USD"


class ApiMeta(BaseModel):
    source: Literal["api"] = "api"


# Suppliers
class SupplierBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    rif: str
    email: str = ""
    phoneCountryCode: str = "+58"
    phoneNumber: str = ""
    phoneE164: str | None = None
    categoryIds: list[str] = Field(default_factory=list)
    responsible: str
    isActive: bool = True
    creditDays: int = 0
    balance: float = 0.0

    @model_validator(mode="before")
    @classmethod
    def _normalize_aliases(cls, values: object) -> object:
        next_values = _apply_aliases(values, "rif", ("rfc",))
        next_values = _apply_aliases(next_values, "phoneNumber", ("phone",))
        next_values = _apply_aliases(next_values, "isActive", ("status",))
        if isinstance(next_values, dict) and "status" in next_values:
            raw_status = next_values.get("status")
            if isinstance(raw_status, bool):
                next_values["isActive"] = raw_status
            else:
                next_values["isActive"] = str(raw_status).strip().lower() not in {
                    "inactive",
                    "inactivo",
                    "0",
                    "false",
                    "disabled",
                }
        return next_values

    @model_validator(mode="after")
    def _normalize_fields(self) -> "SupplierBase":
        self.name = self.name.strip()
        if len(self.name) < 3:
            raise ValueError("El nombre o razón social debe tener al menos 3 caracteres.")
        self.rif = normalize_rif_value(self.rif)
        self.rif = validate_rif_normalized(self.rif)
        normalized_email = (self.email or "").strip()
        self.email = validate_email_value(normalized_email) if normalized_email else ""
        self.phoneCountryCode = normalize_country_code(self.phoneCountryCode)
        self.phoneNumber = normalize_phone_number(self.phoneNumber)
        self.phoneE164 = normalize_phone_e164(self.phoneCountryCode, self.phoneNumber, self.phoneE164)
        if self.phoneE164:
            self.phoneE164 = validate_phone_e164(self.phoneE164)
        else:
            self.phoneE164 = None

        if not self.email and not self.phoneE164:
            raise ValueError("Debes registrar al menos un medio de contacto: teléfono o email.")
        if self.creditDays < 0:
            raise ValueError("creditDays no puede ser negativo.")
        return self


class SupplierCreate(SupplierBase):
    pass


class SupplierUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str | None = None
    rif: str | None = None
    email: str | None = None
    phoneCountryCode: str | None = None
    phoneNumber: str | None = None
    phoneE164: str | None = None
    categoryIds: list[str] | None = None
    responsible: str | None = None
    isActive: bool | None = None
    creditDays: int | None = None
    balance: float | None = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_aliases(cls, values: object) -> object:
        next_values = _apply_aliases(values, "rif", ("rfc",))
        next_values = _apply_aliases(next_values, "phoneNumber", ("phone",))
        next_values = _apply_aliases(next_values, "isActive", ("status",))
        if isinstance(next_values, dict) and "status" in next_values:
            raw_status = next_values.get("status")
            if isinstance(raw_status, bool):
                next_values["isActive"] = raw_status
            else:
                next_values["isActive"] = str(raw_status).strip().lower() not in {
                    "inactive",
                    "inactivo",
                    "0",
                    "false",
                    "disabled",
                }
        return next_values

    @model_validator(mode="after")
    def _normalize_fields(self) -> "SupplierUpdate":
        if self.rif is not None:
            self.rif = validate_rif_normalized(normalize_rif_value(self.rif))
        if self.email is not None:
            normalized_email = self.email.strip()
            self.email = validate_email_value(normalized_email) if normalized_email else ""

        if self.phoneCountryCode is not None or self.phoneNumber is not None or self.phoneE164 is not None:
            country_code = normalize_country_code(self.phoneCountryCode or "+58")
            phone_number = normalize_phone_number(self.phoneNumber or "")
            phone_e164 = normalize_phone_e164(country_code, phone_number, self.phoneE164)
            self.phoneCountryCode = country_code
            self.phoneNumber = phone_number
            self.phoneE164 = validate_phone_e164(phone_e164) if phone_e164 else None

        if self.creditDays is not None and self.creditDays < 0:
            raise ValueError("creditDays no puede ser negativo.")
        return self


class SupplierRead(SupplierBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    createdAt: datetime


# Categories
class CategoryBase(BaseModel):
    name: str
    description: str | None = None


class CategoryCreate(CategoryBase):
    pass


class CategoryRead(CategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: str


# Products
class ProductBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    categoryId: str
    name: str
    description: str | None = None
    unit: str
    isTypical: bool = True
    isActive: bool = True


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    categoryId: str | None = None
    name: str | None = None
    description: str | None = None
    unit: str | None = None
    isTypical: bool | None = None
    isActive: bool | None = None


class ProductRead(ProductBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    createdAt: datetime


# Price lists
class PriceListBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    validFrom: datetime | str
    validTo: datetime | str | None = None
    supplierId: str | None = None
    currency: str = "USD"
    isActive: bool = True

    @model_validator(mode="after")
    def _normalize_currency(self) -> "PriceListBase":
        self.currency = normalize_currency_usd(self.currency)
        return self


class PriceListCreate(PriceListBase):
    pass


class PriceListUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str | None = None
    validFrom: datetime | str | None = None
    validTo: datetime | str | None = None
    supplierId: str | None = None
    currency: str | None = None
    isActive: bool | None = None

    @model_validator(mode="after")
    def _normalize_currency(self) -> "PriceListUpdate":
        if self.currency is not None:
            self.currency = normalize_currency_usd(self.currency)
        return self


class PriceListRead(PriceListBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    createdBy: str
    createdAt: datetime


class PriceListItemBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    priceListId: str
    productId: str
    unit: str
    price: float


class PriceListItemCreate(PriceListItemBase):
    pass


class PriceListItemUpdate(BaseModel):
    unit: str | None = None
    price: float | None = None


class PriceListItemRead(PriceListItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    createdAt: datetime


# Purchase orders
PurchaseOrderStatus = Literal["draft", "pending", "approved", "rejected", "certified", "received"]


class PurchaseOrderItem(BaseModel):
    id: str
    productId: str | None = None
    description: str
    quantity: float
    unit: str | None = None
    unitPrice: float
    total: float
    categoryId: str | None = None
    removedBySuperadmin: bool = False
    removedBySuperadminReason: str | None = None


class PurchaseOrderItemInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    productId: str | None = None
    description: str
    quantity: float
    unit: str | None = None
    unitPrice: float
    categoryId: str | None = None


class PurchaseOrderCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    supplierId: str
    date: datetime | str
    items: list[PurchaseOrderItemInput] = Field(default_factory=list)
    reason: str | None = None

    @model_validator(mode="after")
    def _validate_required_items(self) -> "PurchaseOrderCreate":
        if not self.items:
            raise ValueError("La orden de compra requiere al menos un item.")
        return self


class PurchaseOrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    orderNumber: str
    supplierId: str
    supplierName: str
    date: datetime
    status: PurchaseOrderStatus
    items: list[PurchaseOrderItem] = Field(default_factory=list)
    subtotal: float
    tax: float
    total: float
    reason: str | None = None
    rejectionReason: str | None = None
    approvedBy: str | None = None
    approvedAt: datetime | None = None
    rejectedBy: str | None = None
    rejectedAt: datetime | None = None
    submittedAt: datetime | None = None
    certifiedAt: datetime | None = None
    receivedAt: datetime | None = None
    createdBy: str
    createdAt: datetime


class PurchaseOrderRejectRequest(BaseModel):
    reason: str


class PurchaseOrderApproveRequest(BaseModel):
    reason: str | None = None


class PurchaseOrderRemoveItemRequest(BaseModel):
    reason: str


class PurchaseOrderStatusUpdate(BaseModel):
    status: PurchaseOrderStatus
    reason: str | None = None


# Monitoring movement history
class MovementHistoryRead(BaseModel):
    id: str
    createdAt: datetime
    userId: str
    userName: str
    role: str
    eventType: str
    action: str
    entityType: str
    entityId: str
    detail: dict
    result: Literal["OK", "Error"]
    errorMessage: str | None = None


# Inventory
class DepartmentCreate(BaseModel):
    name: str
    isActive: bool = True


class DepartmentRead(BaseModel):
    id: str
    name: str
    isActive: bool


class InventoryItemRead(BaseModel):
    id: str
    productId: str
    stock: float
    location: str | None = None
    assetType: str
    updatedAt: datetime


class InventoryOutRequest(BaseModel):
    productId: str
    qty: float
    departmentId: str
    reason: str


class InventoryMovementRead(BaseModel):
    id: str
    type: Literal["IN", "OUT"]
    productId: str
    qty: float
    departmentId: str | None = None
    reason: str | None = None
    purchaseOrderId: str | None = None
    createdBy: str
    createdAt: datetime


# Finance module
class FinancePaymentCreate(BaseModel):
    purchaseOrderId: str
    amount: float
    currency: str = "USD"
    paymentType: Literal["contado", "credito"]
    paymentMode: str
    reference: str | None = None
    concept: str | None = None

    @model_validator(mode="after")
    def _normalize_currency(self) -> "FinancePaymentCreate":
        self.currency = normalize_currency_usd(self.currency)
        return self


class FinanceInstallmentCreate(BaseModel):
    purchaseOrderId: str
    financePaymentId: str | None = None
    amount: float
    currency: str = "USD"
    concept: str | None = None

    @model_validator(mode="after")
    def _normalize_currency(self) -> "FinanceInstallmentCreate":
        self.currency = normalize_currency_usd(self.currency)
        return self


class FinanceLateFeeCreate(BaseModel):
    purchaseOrderId: str
    mode: Literal["percentage", "fixed"]
    percentageMonthly: float | None = None
    fixedAmount: float | None = None
    concept: str | None = None


class FinanceReceiptCreate(BaseModel):
    purchaseOrderId: str
    financePaymentId: str | None = None
    amount: float
    currency: str = "USD"

    @model_validator(mode="after")
    def _normalize_currency(self) -> "FinanceReceiptCreate":
        self.currency = normalize_currency_usd(self.currency)
        return self


class FinancePaymentRead(BaseModel):
    id: str
    purchaseOrderId: str
    amount: float
    currency: str
    paymentType: str
    paymentMode: str
    reference: str | None = None
    concept: str | None = None
    createdBy: str
    createdAt: datetime


class FinanceInstallmentRead(BaseModel):
    id: str
    purchaseOrderId: str
    financePaymentId: str | None = None
    amount: float
    currency: str
    concept: str | None = None
    createdBy: str
    createdAt: datetime


class FinanceLateFeeRead(BaseModel):
    id: str
    purchaseOrderId: str
    mode: str
    percentageMonthly: float | None = None
    fixedAmount: float | None = None
    calculatedAmount: float
    concept: str | None = None
    createdBy: str
    createdAt: datetime


class FinanceReceiptRead(BaseModel):
    id: str
    receiptNumber: str
    purchaseOrderId: str
    financePaymentId: str | None = None
    amount: float
    currency: str
    generatedPdfPath: str | None = None
    createdBy: str
    createdAt: datetime


# Legacy compatibility contracts (deprecated but kept for backward compatibility).
class InvoiceCreate(BaseModel):
    purchaseOrderId: str
    invoiceNumber: str
    issueDate: datetime | str
    dueDate: datetime | str
    amount: float


class PaymentCreate(BaseModel):
    invoiceId: str
    date: datetime | str
    amount: float
    method: Literal["transfer", "check", "cash"]
    reference: str
    reason: str | None = None
    notes: str | None = None
    proofUrl: str | None = None
    createdBy: str | None = None


# Legacy auth/users
UserRole = Literal["superadmin", "finanzas", "procura"]


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    name: str
    role: UserRole
    createdAt: datetime


class UserCreate(BaseModel):
    name: str
    email: str
    role: UserRole
    password: str
    securityQuestions: list["UserSecurityQuestionInput"] = Field(default_factory=list)


class UserUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    role: UserRole | None = None
    password: str | None = None
    securityQuestions: list["UserSecurityQuestionInput"] | None = None


class AuthLoginRequest(BaseModel):
    email: str
    password: str


class SecurityQuestionRead(BaseModel):
    id: int
    questionText: str
    active: bool = True


class UserSecurityQuestionInput(BaseModel):
    questionId: int
    answer: str


class UserSecurityQuestionRead(BaseModel):
    questionId: int
    questionText: str


class PasswordRecoveryStartRequest(BaseModel):
    identifier: str


class PasswordRecoveryAnswerInput(BaseModel):
    questionId: int
    answer: str


class PasswordRecoveryVerifyRequest(BaseModel):
    recoveryToken: str
    answers: list[PasswordRecoveryAnswerInput]


class PasswordRecoveryResetRequest(BaseModel):
    resetToken: str
    newPassword: str


class ReportFilters(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    startDate: datetime | str | None = None
    endDate: datetime | str | None = None
    userId: str | None = None
    supplierId: str | None = None
    status: str | None = None
    method: str | None = None
    entity: str | None = None
    createdBy: str | None = None


class CompanySettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    rif: str
    address: str
    phone: str
    email: str
    logo: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_rif_alias(cls, values: object) -> object:
        return _apply_aliases(values, "rif", ("rfc",))


class LateFeesRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    enabled: bool
    percentage: float
    graceDays: int


class CompanySettingsUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    rif: str
    address: str
    phone: str
    email: str
    logo: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_rif_alias(cls, values: object) -> object:
        return _apply_aliases(values, "rif", ("rfc",))


class LateFeesUpdate(BaseModel):
    enabled: bool
    percentage: float
    graceDays: int

