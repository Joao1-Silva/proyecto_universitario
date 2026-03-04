import unittest
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.finance_crud import calculate_purchase_order_totals, create_payment, parse_datetime_input
from app.models import InvoiceModel, PurchaseOrderModel, SupplierModel
from app.schemas import PaymentCreate, SupplierCreate


class FinanceCrudTests(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
        Base.metadata.create_all(bind=engine)
        self.session = SessionLocal()

        supplier = SupplierModel(
            id="supplier_test",
            name="Proveedor Test",
            rfc="J123456789",
            email="proveedor@test.com",
            phone="+52 555 0000",
            category_ids=["cat-servicios"],
            responsible="Responsable",
            status="active",
            credit_days=30,
            balance=0.0,
            created_at=datetime.utcnow(),
        )
        purchase_order = PurchaseOrderModel(
            id="po_test",
            order_number="OC-2026-001",
            supplier_id=supplier.id,
            supplier_name=supplier.name,
            date=datetime.utcnow(),
            status="draft",
            items=[],
            subtotal=1000.0,
            tax=0.0,
            total=1000.0,
            reason="Prueba",
            created_by="Tester",
            created_at=datetime.utcnow(),
        )
        invoice = InvoiceModel(
            id="inv_test",
            invoice_number="FAC-2026-001",
            purchase_order_id=purchase_order.id,
            supplier_id=supplier.id,
            supplier_name=supplier.name,
            issue_date=datetime.utcnow(),
            due_date=datetime.utcnow(),
            status="pending",
            amount=1000.0,
            paid_amount=0.0,
            balance=1000.0,
            created_at=datetime.utcnow(),
        )
        self.session.add_all([supplier, purchase_order, invoice])
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()

    def test_calculate_purchase_order_totals_respects_service_iva_flag(self) -> None:
        subtotal, tax, total = calculate_purchase_order_totals(
            [
                {"total": 100.0, "isService": True, "appliesIva": True},
                {"total": 200.0, "isService": True, "appliesIva": False},
                {"total": 50.0, "isService": False, "appliesIva": False},
            ]
        )
        self.assertEqual(subtotal, 350.0)
        self.assertEqual(tax, 16.0)
        self.assertEqual(total, 366.0)

    def test_parse_datetime_input_date_only_uses_noon(self) -> None:
        parsed = parse_datetime_input("2026-02-13", "date")
        self.assertEqual(parsed.hour, 12)
        self.assertEqual(parsed.minute, 0)

    def test_create_payment_rejects_amount_above_balance(self) -> None:
        with self.assertRaises(ValueError):
            create_payment(
                self.session,
                PaymentCreate(
                    invoiceId="inv_test",
                    date="2026-02-13",
                    amount=1200,
                    method="transfer",
                    reference="REF-1",
                    reason="Prueba",
                ),
            )

    def test_create_payment_updates_invoice_to_partial_and_paid(self) -> None:
        first_payment = create_payment(
            self.session,
            PaymentCreate(
                invoiceId="inv_test",
                date="2026-02-13",
                amount=300,
                method="transfer",
                reference="REF-300",
                reason="Abono inicial",
            ),
        )
        self.assertEqual(first_payment["amount"], 300)

        invoice = self.session.get(InvoiceModel, "inv_test")
        self.assertIsNotNone(invoice)
        assert invoice is not None
        self.assertEqual(invoice.paid_amount, 300)
        self.assertEqual(invoice.balance, 700)
        self.assertEqual(invoice.status, "partial")

        create_payment(
            self.session,
            PaymentCreate(
                invoiceId="inv_test",
                date="2026-02-14",
                amount=700,
                method="cash",
                reference="REF-700",
                reason="Liquidacion",
            ),
        )
        invoice = self.session.get(InvoiceModel, "inv_test")
        self.assertIsNotNone(invoice)
        assert invoice is not None
        self.assertEqual(invoice.paid_amount, 1000)
        self.assertEqual(invoice.balance, 0)
        self.assertEqual(invoice.status, "paid")

    def test_supplier_create_normalizes_phone_e164(self) -> None:
        supplier = SupplierCreate(
            name="Proveedor Valido",
            rif="J-51234567-8",
            email="",
            phoneCountryCode="+58",
            phoneNumber="(412) 123-4567",
            categoryIds=["cat-servicios"],
            responsible="Responsable",
            isActive=True,
            creditDays=15,
            balance=0.0,
        )
        self.assertEqual(supplier.phoneE164, "+584121234567")


if __name__ == "__main__":
    unittest.main()
