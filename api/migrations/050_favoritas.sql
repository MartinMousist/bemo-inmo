-- 050 · Propiedades marcadas como favoritas
--
-- ═══ ES DE LA PERSONA, NO DE LA INMOBILIARIA ═══
--
-- La clave primaria lleva el USUARIO, no sólo el tenant. Una asesora marca las
-- seis propiedades que le está mostrando a su cliente del jueves; que esas seis
-- le aparezcan marcadas al resto de la oficina convertiría un anotador personal
-- en un ranking involuntario de la cartera.
--
-- Es lo contrario de `red_compartida`, que sí es una decisión de la casa.
--
-- ── Se borra con el usuario, no se conserva ──
--
-- `ON DELETE CASCADE` sobre `usuario`: cuando alguien se va de la inmobiliaria,
-- sus marcas personales se van con él. No son un dato del negocio y guardarlas
-- sólo dejaría filas que nadie puede volver a leer.

BEGIN;

CREATE TABLE propiedad_favorita (
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  propiedad_id uuid NOT NULL,
  usuario_id   uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (usuario_id, propiedad_id),
  FOREIGN KEY (tenant_id, propiedad_id) REFERENCES propiedad (tenant_id, id) ON DELETE CASCADE
);

-- Para «mostrame las mías», que es la única otra pregunta que se le hace.
CREATE INDEX ix_favorita_usuario ON propiedad_favorita (usuario_id, created_at DESC);

ALTER TABLE propiedad_favorita ENABLE ROW LEVEL SECURITY;

-- RLS acota por INMOBILIARIA; el filtro por usuario lo pone la consulta.
-- Mezclar las dos cosas en la policy haría que una consulta sin `usuario_id`
-- devuelva vacío en vez de fallar, y ese es el tipo de error que no se ve.
CREATE POLICY favorita_del_tenant ON propiedad_favorita
  USING (tenant_id = app_current_tenant());

GRANT SELECT, INSERT, DELETE ON propiedad_favorita TO app_role;

CREATE CONSTRAINT TRIGGER tg_favorita_usuario_del_tenant
  AFTER INSERT OR UPDATE OF usuario_id ON propiedad_favorita
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_verificar_agente_del_tenant('usuario_id');

COMMIT;
