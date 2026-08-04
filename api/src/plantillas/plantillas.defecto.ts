/**
 * Plantillas base.
 *
 * ⚠️ Son un PUNTO DE PARTIDA, no un modelo legal. Cada inmobiliaria las edita
 * con su redacción, su escribanía y las cláusulas que su abogado le indique.
 * Se copian a la cuenta al sembrarlas justamente para que editarlas no cambie
 * el contrato de las demás.
 *
 * Están escritas contra el régimen vigente: desde el DNU 70/2023 los contratos
 * de locación son de forma libre, así que el plazo, la moneda, el índice y la
 * periodicidad se pactan y por eso salen de los datos del contrato.
 */
export const PLANTILLAS_POR_DEFECTO: Array<{
  tipo: string;
  nombre: string;
  contenido: string;
}> = [
  {
    tipo: 'pre_contrato_alquiler',
    nombre: 'Pre-contrato de locación',
    contenido: `CONTRATO DE LOCACIÓN

En {{ propiedad.localidad }}, a los {{ hoy | fecha_larga }}, entre:

LOCADOR: {{ locador.nombre }}, {{ locador.tipoDocumento }} {{ locador.documento }},
con domicilio en {{ locador.domicilio }}.
{% si locadores %}{% para l en locadores %}{% si l.porcentaje %}  · {{ l.nombre }} — {{ l.porcentaje }}% de titularidad
{% fin %}{% fin %}{% fin %}
LOCATARIO: {{ locatario.nombre }}, {{ locatario.tipoDocumento }} {{ locatario.documento }},
con domicilio en {{ locatario.domicilio }}.

Se conviene lo siguiente:

PRIMERA — OBJETO.
El LOCADOR da en locación al LOCATARIO el inmueble sito en
{{ propiedad.direccion }}, con destino de vivienda.

SEGUNDA — PLAZO.
El plazo es desde el {{ contrato.inicio | fecha_larga }} hasta el
{{ contrato.fin | fecha_larga }}, fecha en que el LOCATARIO deberá restituir el
inmueble sin necesidad de interpelación previa.

TERCERA — PRECIO.
El precio mensual se fija en {{ contrato.monto | moneda }}
({{ contrato.monto | letras }}), pagadero por adelantado del 1 al
{{ contrato.diaVencimiento }} de cada mes.

CUARTA — ACTUALIZACIÓN.
El precio se actualizará cada {{ contrato.periodicidad }} meses conforme al
índice {{ contrato.indice }}. La actualización se aplicará sobre el valor
vigente al momento del ajuste, y se comunicará al LOCATARIO con el detalle del
cálculo empleado.

QUINTA — MORA.
La falta de pago en término devengará un interés punitorio del
{{ contrato.punitorioDiario }}% diario, sin necesidad de interpelación.

{% si contrato.deposito %}SEXTA — DEPÓSITO.
El LOCATARIO entrega en este acto la suma de {{ contrato.deposito | moneda }}
en concepto de depósito en garantía, que le será restituida al finalizar la
locación una vez verificado el estado del inmueble y canceladas las
obligaciones a su cargo.

{% fin %}{% si garantes %}SÉPTIMA — GARANTÍA.
Se constituyen en garantes solidarios, lisos, llanos y principales pagadores:
{% para g en garantes %}  · {{ g.nombre }}, documento {{ g.documento }}, con domicilio en {{ g.domicilio }}.
{% fin %}
{% fin %}OCTAVA — INTERMEDIACIÓN.
Interviene {{ inmobiliaria.nombre }}, CUIT {{ inmobiliaria.cuit }}, en carácter
de administradora de la presente locación.

NOVENA — DOMICILIOS.
Las partes constituyen domicilios especiales en los indicados al inicio, donde
serán válidas todas las notificaciones.

En prueba de conformidad se firman dos ejemplares de un mismo tenor.


    ________________________            ________________________
        {{ locador.nombre }}                {{ locatario.nombre }}
             LOCADOR                            LOCATARIO
`,
  },

  {
    tipo: 'aviso_aumento',
    nombre: 'Aviso de actualización',
    contenido: `{{ propiedad.localidad }}, {{ hoy | fecha_larga }}

Sr./Sra. {{ locatario.nombre }}

Ref.: actualización del alquiler — {{ propiedad.direccion }}

De nuestra consideración:

Le informamos que, conforme a la cláusula de actualización del contrato de
locación, corresponde ajustar el valor del alquiler según el índice
{{ contrato.indice }}, con la periodicidad de {{ contrato.periodicidad }} meses
pactada.

    Alquiler vigente:  {{ contrato.montoVigente | moneda }}

El detalle del cálculo, con los valores del índice utilizados y el coeficiente
resultante, se acompaña a la presente y está disponible para su consulta.

Quedamos a disposición por cualquier consulta.

Atentamente,

{{ inmobiliaria.nombre }}
`,
  },

  {
    tipo: 'aviso_vencimiento',
    nombre: 'Aviso de vencimiento de contrato',
    contenido: `{{ propiedad.localidad }}, {{ hoy | fecha_larga }}

Sr./Sra. {{ locatario.nombre }}

Ref.: vencimiento del contrato — {{ propiedad.direccion }}

De nuestra consideración:

Le recordamos que el contrato de locación del inmueble de referencia vence el
{{ contrato.fin | fecha_larga }}.

Le solicitamos nos indique su intención respecto de la renovación, a fin de
poder acordar con la debida antelación las condiciones correspondientes o, en
su defecto, coordinar la entrega del inmueble.

Atentamente,

{{ inmobiliaria.nombre }}
`,
  },

  {
    tipo: 'recibo',
    nombre: 'Recibo de alquiler',
    // Usa `cobro.monto` y NO `contrato.montoVigente`: el recibo dice lo que
    // realmente se pagó. Con un pago parcial, el alquiler nominal sería un
    // comprobante por un monto que nadie entregó.
    contenido: `RECIBO

{{ inmobiliaria.nombre }} — CUIT {{ inmobiliaria.cuit }}

Recibí de {{ locatario.nombre }}, {{ locatario.tipoDocumento }} {{ locatario.documento }},
la suma de {{ cobro.monto | moneda }}
({{ cobro.monto | letras }}) en concepto de {{ cobro.concepto }} del inmueble
sito en {{ propiedad.direccion }}, correspondiente al período
{{ cobro.periodoTexto }}.

Forma de pago: {{ cobro.medio }}.
{% si cobro.comprobante %}Comprobante: {{ cobro.comprobante }}.
{% fin %}{% si cobro.esParcial %}
Este pago es PARCIAL. Queda un saldo de {{ cobro.saldo | moneda }} sobre la
cuota de {{ cobro.totalCuota | moneda }}.
{% fin %}
{{ propiedad.localidad }}, {{ cobro.fecha | fecha_larga }}


                          ________________________
                              {{ inmobiliaria.nombre }}
`,
  },
];
