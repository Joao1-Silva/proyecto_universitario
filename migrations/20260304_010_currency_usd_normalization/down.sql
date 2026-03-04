-- Rollback parcial:
-- La normalización de moneda a USD se mantiene para respetar las restricciones CHECK de esquema.

UPDATE departments
SET name = 'Almacen'
WHERE name = 'Almacén';
