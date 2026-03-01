from dataclasses import dataclass


@dataclass(frozen=True)
class CategorySeed:
    id: str
    name: str
    description: str | None = None


DEFAULT_CATEGORIES: list[CategorySeed] = [
    CategorySeed(id="cat-epp-cabeza-cuerpo", name="Proteccion Personal (EPP - Cabeza y Cuerpo)"),
    CategorySeed(id="cat-extremidades", name="Proteccion de Extremidades (Manos y Pies)"),
    CategorySeed(id="cat-senalizacion-vial", name="Senalizacion y Seguridad Vial"),
    CategorySeed(id="cat-escritura-papeleria", name="Consumibles de Escritura y Papeleria"),
    CategorySeed(id="cat-impresion-tecnologia", name="Insumos de Impresion y Tecnologia"),
]

ROLE_NORMALIZATION: dict[str, str] = {
    "admin": "superadmin",
    "superadmin": "superadmin",
    "gerente": "superadmin",
    "finance": "finanzas",
    "finanzas": "finanzas",
    "administradora": "finanzas",
    "procura": "procura",
    "viewer": "procura",
    "compras": "procura",
}
