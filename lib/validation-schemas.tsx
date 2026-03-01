/**
 * Validation Schemas for Forms
 * Use these with react-hook-form and zod for client-side validation
 */

// Supplier validation schema
export const SupplierSchema = {
  name: {
    required: "El nombre es requerido",
    minLength: { value: 3, message: "Minimo 3 caracteres" },
    maxLength: { value: 100, message: "Maximo 100 caracteres" },
  },
  rif: {
    required: "El RIF es requerido",
    pattern: {
      value: /^(V|E|J|P|G|C|R)-?\d{8}-?\d$/i,
      message: "RIF invalido",
    },
  },
  email: {
    required: "El email es requerido",
    pattern: {
      value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
      message: "Email invalido",
    },
  },
  phone: {
    required: "El telefono es requerido",
    pattern: {
      value: /^\+?[\d\s-()]+$/,
      message: "Telefono invalido",
    },
  },
  responsible: {
    required: "El responsable es requerido",
    minLength: { value: 2, message: "Minimo 2 caracteres" },
  },
  categoryIds: {
    validate: {
      minItems: (value: string[]) => value.length > 0 || "Selecciona al menos una categoria",
    },
  },
  creditDays: {
    required: "Los dias de credito son requeridos",
    min: { value: 0, message: "Minimo 0 dias" },
    max: { value: 365, message: "Maximo 365 dias" },
  },
}

// Purchase Order validation schema
export const PurchaseOrderSchema = {
  supplierId: {
    required: "El proveedor es requerido",
  },
  date: {
    required: "La fecha es requerida",
  },
  items: {
    required: "Debe haber al menos un item",
    validate: {
      minItems: (items: any[]) => items.length > 0 || "Debe haber al menos un item",
      validItems: (items: any[]) =>
        items.every((item) => item.description && item.quantity > 0 && item.unitPrice >= 0) ||
        "Todos los items deben tener descripcion, cantidad y precio validos",
    },
  },
}

// Invoice validation schema
export const InvoiceSchema = {
  purchaseOrderId: {
    required: "La orden de compra es requerida",
  },
  invoiceNumber: {
    required: "El numero de factura es requerido",
    minLength: { value: 3, message: "Minimo 3 caracteres" },
  },
  issueDate: {
    required: "La fecha de emision es requerida",
  },
  dueDate: {
    required: "La fecha de vencimiento es requerida",
    validate: {
      afterIssue: (value: string, formValues: any) =>
        new Date(value) >= new Date(formValues.issueDate) || "La fecha de vencimiento debe ser posterior a la emision",
    },
  },
  amount: {
    required: "El monto es requerido",
    min: { value: 0.01, message: "El monto debe ser mayor a 0" },
  },
}

// Payment validation schema
export const PaymentSchema = {
  invoiceId: {
    required: "La factura es requerida",
  },
  date: {
    required: "La fecha es requerida",
  },
  amount: {
    required: "El monto es requerido",
    min: { value: 0.01, message: "El monto debe ser mayor a 0" },
  },
  method: {
    required: "El metodo de pago es requerido",
  },
  reference: {
    required: "La referencia es requerida",
    minLength: { value: 3, message: "Minimo 3 caracteres" },
  },
}

/**
 * Example usage with react-hook-form:
 *
 * import { useForm } from 'react-hook-form'
 *
 * const { register, handleSubmit, formState: { errors } } = useForm()
 *
 * <Input {...register('name', SupplierSchema.name)} />
 * {errors.name && <span>{errors.name.message}</span>}
 */
