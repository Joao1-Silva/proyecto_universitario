import os
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import text

TEST_DB_PATH = Path(__file__).resolve().parent / "test_app.sqlite"
if TEST_DB_PATH.exists():
    try:
        TEST_DB_PATH.unlink()
    except PermissionError:
        pass

os.environ["DB_DIALECT"] = "sqlite"
os.environ["DB_REQUIRE_MARIADB"] = "false"
os.environ["SQLITE_PATH"] = str(TEST_DB_PATH)

from app.main import app  # noqa: E402
from app.db import get_engine  # noqa: E402


class RbacRecoveryReportsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.__exit__(None, None, None)
        if TEST_DB_PATH.exists():
            try:
                TEST_DB_PATH.unlink()
            except PermissionError:
                pass

    def _login(self, email: str, password: str) -> str:
        response = self.client.post("/auth/login", json={"email": email, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["data"]["token"]

    @staticmethod
    def _headers(token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def _create_supplier(self, token: str, category_id: str, suffix: str) -> str:
        digits = str((abs(hash(suffix)) % 900000000) + 100000000)
        rif = f"J-{digits[:8]}-{digits[8]}"
        response = self.client.post(
            "/suppliers",
            headers=self._headers(token),
            json={
                "name": f"Proveedor {suffix}",
                "rif": rif,
                "email": f"proveedor.{suffix.lower()}@empresa.com",
                "phoneCountryCode": "+58",
                "phoneNumber": "4121234567",
                "categoryIds": [category_id],
                "responsible": "Responsable Test",
                "isActive": True,
                "creditDays": 15,
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["data"]["id"]

    def _create_purchase_order(self, token: str, supplier_id: str, product_id: str, category_id: str) -> str:
        response = self.client.post(
            "/purchase-orders",
            headers=self._headers(token),
            json={
                "supplierId": supplier_id,
                "date": "2026-03-15",
                "items": [
                    {
                        "productId": product_id,
                        "description": "Item test",
                        "quantity": 2,
                        "unit": "unidad",
                        "unitPrice": 125,
                        "categoryId": category_id,
                    }
                ],
                "reason": "Orden de prueba",
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["data"]["id"]

    def test_01_rbac_forbidden_actions(self) -> None:
        superadmin_token = self._login("juan.perez@empresa.com", "Admin123!")
        finance_token = self._login("maria.lopez@empresa.com", "Finance123!")
        procura_token = self._login("carlos.ruiz@empresa.com", "Procura123!")

        categories_response = self.client.get("/categories", headers=self._headers(superadmin_token))
        self.assertEqual(categories_response.status_code, 200, categories_response.text)
        category_id = categories_response.json()["data"][0]["id"]

        finance_create_supplier = self.client.post(
            "/suppliers",
            headers=self._headers(finance_token),
            json={
                "name": "Proveedor RBAC",
                "rif": "J-41234567-8",
                "email": "proveedor.rbac@empresa.com",
                "phoneCountryCode": "+58",
                "phoneNumber": "4121234567",
                "categoryIds": [category_id],
                "responsible": "Responsable RBAC",
                "isActive": True,
                "creditDays": 15,
            },
        )
        self.assertEqual(finance_create_supplier.status_code, 403, finance_create_supplier.text)

        finance_create_po = self.client.post(
            "/purchase-orders",
            headers=self._headers(finance_token),
            json={
                "supplierId": "supplier_x",
                "date": "2026-03-15",
                "items": [{"description": "Item", "quantity": 1, "unitPrice": 10}],
            },
        )
        self.assertEqual(finance_create_po.status_code, 403, finance_create_po.text)

        supplier_id = self._create_supplier(superadmin_token, category_id, "RBAC")

        products_response = self.client.get("/products", headers=self._headers(procura_token))
        self.assertEqual(products_response.status_code, 200, products_response.text)
        products = products_response.json()["data"]
        if not products:
            create_product = self.client.post(
                "/products",
                headers=self._headers(procura_token),
                json={
                    "categoryId": category_id,
                    "name": "Producto RBAC",
                    "description": "Producto test",
                    "unit": "unidad",
                    "isTypical": True,
                    "isActive": True,
                },
            )
            self.assertEqual(create_product.status_code, 201, create_product.text)
            product_id = create_product.json()["data"]["id"]
        else:
            product_id = products[0]["id"]

        po_id = self._create_purchase_order(procura_token, supplier_id, product_id, category_id)

        procura_approve = self.client.post(f"/purchase-orders/{po_id}/approve", headers=self._headers(procura_token), json={})
        self.assertEqual(procura_approve.status_code, 403, procura_approve.text)

        procura_finance = self.client.post(
            "/finanzas/pagos",
            headers=self._headers(procura_token),
            json={
                "purchaseOrderId": po_id,
                "amount": 100,
                "currency": "USD",
                "paymentType": "contado",
                "paymentMode": "transferencia",
            },
        )
        self.assertEqual(procura_finance.status_code, 403, procura_finance.text)

        superadmin_activate = self.client.post(f"/suppliers/{supplier_id}/deactivate", headers=self._headers(superadmin_token))
        self.assertEqual(superadmin_activate.status_code, 200, superadmin_activate.text)

    def test_02_reports_pdf_and_data(self) -> None:
        superadmin_token = self._login("juan.perez@empresa.com", "Admin123!")
        procura_token = self._login("carlos.ruiz@empresa.com", "Procura123!")
        finance_token = self._login("maria.lopez@empresa.com", "Finance123!")

        categories_response = self.client.get("/categories", headers=self._headers(superadmin_token))
        category_id = categories_response.json()["data"][0]["id"]

        supplier_id = self._create_supplier(superadmin_token, category_id, "REPORTES")

        products_response = self.client.get("/products", headers=self._headers(procura_token))
        products = products_response.json().get("data", [])
        if not products:
            create_product = self.client.post(
                "/products",
                headers=self._headers(procura_token),
                json={
                    "categoryId": category_id,
                    "name": "Producto Reportes",
                    "description": "Producto para reportes",
                    "unit": "unidad",
                    "isTypical": True,
                    "isActive": True,
                },
            )
            self.assertEqual(create_product.status_code, 201, create_product.text)
            product_id = create_product.json()["data"]["id"]
        else:
            product_id = products[0]["id"]

        po_id = self._create_purchase_order(procura_token, supplier_id, product_id, category_id)

        submit_response = self.client.post(f"/purchase-orders/{po_id}/submit", headers=self._headers(procura_token))
        self.assertEqual(submit_response.status_code, 200, submit_response.text)

        approve_response = self.client.post(
            f"/purchase-orders/{po_id}/approve",
            headers=self._headers(superadmin_token),
            json={"reason": "Aprobacion test"},
        )
        self.assertEqual(approve_response.status_code, 200, approve_response.text)

        certify_response = self.client.post(f"/purchase-orders/{po_id}/certify", headers=self._headers(procura_token))
        self.assertEqual(certify_response.status_code, 200, certify_response.text)

        finance_payment = self.client.post(
            "/finanzas/pagos",
            headers=self._headers(finance_token),
            json={
                "purchaseOrderId": po_id,
                "amount": 250,
                "currency": "USD",
                "paymentType": "contado",
                "paymentMode": "transferencia",
                "reference": "REP-001",
                "concept": "Pago inicial",
            },
        )
        self.assertEqual(finance_payment.status_code, 201, finance_payment.text)

        report_types = ["movement-history", "finanzas", "purchase-orders", "inventory-movements"]
        for report_type in report_types:
            data_response = self.client.get(
                f"/reports/{report_type}",
                headers=self._headers(superadmin_token),
                params={"startDate": "2026-03-01", "endDate": "2026-03-31"},
            )
            self.assertEqual(data_response.status_code, 200, data_response.text)
            parsed = data_response.json()["data"]
            self.assertIn("rows", parsed)
            self.assertIn("totals", parsed)

            pdf_response = self.client.post(
                f"/reports/{report_type}/pdf",
                headers=self._headers(superadmin_token),
                json={"startDate": "2026-03-01", "endDate": "2026-03-31"},
            )
            self.assertEqual(pdf_response.status_code, 200, pdf_response.text)
            pdf_payload = pdf_response.json()["data"]
            self.assertTrue(len(pdf_payload["contentBase64"]) > 100)

    def test_03_password_recovery_flow(self) -> None:
        start_response = self.client.post(
            "/auth/password-recovery/start",
            json={"identifier": "juan.perez@empresa.com"},
        )
        self.assertEqual(start_response.status_code, 200, start_response.text)
        start_payload = start_response.json()["data"]
        recovery_token = start_payload["recoveryToken"]
        questions = start_payload["questions"]
        self.assertEqual(len(questions), 3)

        wrong_answers_response = self.client.post(
            "/auth/password-recovery/verify",
            json={
                "recoveryToken": recovery_token,
                "answers": [{"questionId": question["questionId"], "answer": "respuesta_incorrecta"} for question in questions],
            },
        )
        self.assertEqual(wrong_answers_response.status_code, 401, wrong_answers_response.text)

        restart_response = self.client.post(
            "/auth/password-recovery/start",
            json={"identifier": "juan.perez@empresa.com"},
        )
        self.assertEqual(restart_response.status_code, 200, restart_response.text)
        restart_payload = restart_response.json()["data"]
        recovery_token = restart_payload["recoveryToken"]
        questions = restart_payload["questions"]

        expected_answers = ["Admin123!", "SYMBIOS", "Operación"]
        correct_answers_response = self.client.post(
            "/auth/password-recovery/verify",
            json={
                "recoveryToken": recovery_token,
                "answers": [
                    {"questionId": questions[index]["questionId"], "answer": expected_answers[index]}
                    for index in range(len(questions))
                ],
            },
        )
        self.assertEqual(correct_answers_response.status_code, 200, correct_answers_response.text)
        reset_token = correct_answers_response.json()["data"]["resetToken"]

        reset_response = self.client.post(
            "/auth/password-recovery/reset",
            json={"resetToken": reset_token, "newPassword": "Admin456!"},
        )
        self.assertEqual(reset_response.status_code, 200, reset_response.text)

        login_response = self.client.post(
            "/auth/login",
            json={"email": "juan.perez@empresa.com", "password": "Admin456!"},
        )
        self.assertEqual(login_response.status_code, 200, login_response.text)

    def test_04_suppliers_crud_works_when_links_table_is_missing(self) -> None:
        superadmin_token = self._login("juan.perez@empresa.com", "Admin456!")

        categories_response = self.client.get("/categories", headers=self._headers(superadmin_token))
        self.assertEqual(categories_response.status_code, 200, categories_response.text)
        category_id = categories_response.json()["data"][0]["id"]

        engine = get_engine()
        self.assertIsNotNone(engine)
        assert engine is not None
        with engine.begin() as connection:
            connection.execute(text("DROP TABLE IF EXISTS supplier_category_links"))

        create_response = self.client.post(
            "/suppliers",
            headers=self._headers(superadmin_token),
            json={
                "name": "Proveedor Legacy Links Off",
                "rif": "J-51234567-8",
                "email": "proveedor.legacy.links@empresa.com",
                "phoneCountryCode": "+58",
                "phoneNumber": "4127654321",
                "categoryIds": [category_id],
                "responsible": "Responsable Legacy",
                "isActive": True,
                "creditDays": 20,
            },
        )
        self.assertEqual(create_response.status_code, 201, create_response.text)
        supplier_id = create_response.json()["data"]["id"]

        update_response = self.client.put(
            f"/suppliers/{supplier_id}",
            headers=self._headers(superadmin_token),
            json={
                "name": "Proveedor Legacy Editado",
                "email": "proveedor.legacy.editado@empresa.com",
                "phoneCountryCode": "+58",
                "phoneNumber": "4140001122",
                "categoryIds": [category_id],
                "creditDays": 25,
            },
        )
        self.assertEqual(update_response.status_code, 200, update_response.text)
        self.assertEqual(update_response.json()["data"]["name"], "Proveedor Legacy Editado")

        deactivate_response = self.client.post(
            f"/suppliers/{supplier_id}/deactivate",
            headers=self._headers(superadmin_token),
        )
        self.assertEqual(deactivate_response.status_code, 200, deactivate_response.text)
        self.assertFalse(deactivate_response.json()["data"]["isActive"])

        activate_response = self.client.post(
            f"/suppliers/{supplier_id}/activate",
            headers=self._headers(superadmin_token),
        )
        self.assertEqual(activate_response.status_code, 200, activate_response.text)
        self.assertTrue(activate_response.json()["data"]["isActive"])

    def test_05_login_accepts_mobile_style_whitespace(self) -> None:
        response = self.client.post(
            "/auth/login",
            json={
                "email": "  MARIA.LOPEZ@EMPRESA.COM  ",
                "password": "  Finance123!  ",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)

    def test_06_supplier_requires_contact_and_normalizes_phone(self) -> None:
        superadmin_token = self._login("juan.perez@empresa.com", "Admin456!")

        categories_response = self.client.get("/categories", headers=self._headers(superadmin_token))
        self.assertEqual(categories_response.status_code, 200, categories_response.text)
        category_id = categories_response.json()["data"][0]["id"]

        missing_contact = self.client.post(
            "/suppliers",
            headers=self._headers(superadmin_token),
            json={
                "name": "Proveedor Sin Contacto",
                "rif": "J-61234567-8",
                "email": "",
                "phoneCountryCode": "+58",
                "phoneNumber": "",
                "categoryIds": [category_id],
                "responsible": "Responsable Test",
                "isActive": True,
                "creditDays": 15,
            },
        )
        self.assertEqual(missing_contact.status_code, 422, missing_contact.text)

        normalized_phone = self.client.post(
            "/suppliers",
            headers=self._headers(superadmin_token),
            json={
                "name": "Proveedor Telefono Normalizado",
                "rif": "J-61234568-9",
                "email": "",
                "phoneCountryCode": "+58",
                "phoneNumber": "(412) 123-4567",
                "categoryIds": [category_id],
                "responsible": "Responsable Test",
                "isActive": True,
                "creditDays": 15,
            },
        )
        self.assertEqual(normalized_phone.status_code, 201, normalized_phone.text)
        created = normalized_phone.json()["data"]
        self.assertEqual(created["phoneE164"], "+584121234567")
        self.assertEqual(created["email"], "")

    def test_07_finance_installment_balance_summary_and_limit(self) -> None:
        superadmin_token = self._login("juan.perez@empresa.com", "Admin456!")
        procura_token = self._login("carlos.ruiz@empresa.com", "Procura123!")
        finance_token = self._login("maria.lopez@empresa.com", "Finance123!")

        categories_response = self.client.get("/categories", headers=self._headers(superadmin_token))
        self.assertEqual(categories_response.status_code, 200, categories_response.text)
        category_id = categories_response.json()["data"][0]["id"]

        supplier_id = self._create_supplier(superadmin_token, category_id, "SALDO")

        products_response = self.client.get("/products", headers=self._headers(procura_token))
        self.assertEqual(products_response.status_code, 200, products_response.text)
        products = products_response.json().get("data", [])
        if not products:
            create_product = self.client.post(
                "/products",
                headers=self._headers(procura_token),
                json={
                    "categoryId": category_id,
                    "name": "Producto Saldos",
                    "description": "Producto para pruebas de saldo",
                    "unit": "unidad",
                    "isTypical": True,
                    "isActive": True,
                },
            )
            self.assertEqual(create_product.status_code, 201, create_product.text)
            product_id = create_product.json()["data"]["id"]
        else:
            product_id = products[0]["id"]

        po_id = self._create_purchase_order(procura_token, supplier_id, product_id, category_id)

        summary_initial = self.client.get(
            "/finanzas/resumen",
            headers=self._headers(finance_token),
            params={"purchaseOrderId": po_id},
        )
        self.assertEqual(summary_initial.status_code, 200, summary_initial.text)
        initial_row = summary_initial.json()["data"][0]
        self.assertEqual(initial_row["paidAmount"], 0.0)
        self.assertEqual(initial_row["remainingAmount"], initial_row["totalAmount"])
        self.assertEqual(initial_row["status"], "pending")

        first_installment = self.client.post(
            "/finanzas/abonos",
            headers=self._headers(finance_token),
            json={
                "purchaseOrderId": po_id,
                "amount": 100,
                "currency": "USD",
                "concept": "Abono inicial",
            },
        )
        self.assertEqual(first_installment.status_code, 201, first_installment.text)

        summary_after = self.client.get(
            "/finanzas/resumen",
            headers=self._headers(finance_token),
            params={"purchaseOrderId": po_id},
        )
        self.assertEqual(summary_after.status_code, 200, summary_after.text)
        after_row = summary_after.json()["data"][0]
        self.assertEqual(after_row["paidAmount"], 100.0)
        self.assertEqual(after_row["remainingAmount"], round(after_row["totalAmount"] - 100.0, 2))
        self.assertEqual(after_row["status"], "partial")

        exceed_installment = self.client.post(
            "/finanzas/abonos",
            headers=self._headers(finance_token),
            json={
                "purchaseOrderId": po_id,
                "amount": after_row["remainingAmount"] + 1,
                "currency": "USD",
                "concept": "Abono excedente",
            },
        )
        self.assertEqual(exceed_installment.status_code, 422, exceed_installment.text)


if __name__ == "__main__":
    unittest.main()
