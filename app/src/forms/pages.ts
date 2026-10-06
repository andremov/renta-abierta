// Information architecture: a short questionnaire decides which pages apply, and every
// worksheet that takes input belongs to exactly one page (enforced by pages.test.ts).
import type { Model } from '../engine/workbook';

const NOT_INPUT =
  /^(AY_|ENTRADA|Navegacion|TRM_diaria|msg|calidad|plazos|monedas|TOPES|go$|go casa|tarifa imporenta|renta exenta|Retenciones|cesantias|descuentos|ajustes art|Ganancia ocasional exenta|Sanciones|costos y deduc|mod_once|Formulario|Depto)/;

export function inputSheets(model: Model): string[] {
  return model.sheets.filter((s) => !NOT_INPUT.test(s.name) && Object.values(s.cells).some((c) => c.in)).map((s) => s.name);
}

export interface Question {
  id: string;
  text: string;
  hint?: string;
  advanced?: boolean;
}

export interface PageDef {
  id: string;
  title: string;
  /** one-line description shown in lists */
  blurb: string;
  /** annexes; `when` hides one unless a question enabling it is answered yes (or it has data) */
  sheets: { sheet: string; title?: string; when?: string[] }[];
  /** shown when any of these questions is answered yes; omitted = always */
  when?: string[];
  /** orientation shown on the page's first step (paragraphs) */
  guide?: string[];
}

export interface GroupDef {
  id: string;
  title: string;
  pages: PageDef[];
}

export const QUESTIONS: Question[] = [
  { id: 'dependientes', text: '¿Tiene dependientes económicos?', hint: 'Hijos, cónyuge, padres o hermanos que dependen económicamente de usted.' },
  { id: 'signatario', text: '¿Otra persona firma la declaración en su nombre?', hint: 'Apoderado o representante.', advanced: true },
  { id: 'salario', text: '¿Recibió salario o pagos de un empleador?', hint: 'Contrato laboral: salario, prestaciones, cesantías, gastos de representación.' },
  {
    id: 'otros_laborales',
    text: '¿Recibió otros pagos laborales, como indemnizaciones, bonificaciones por retiro o primas especiales?',
    hint: 'Pagos distintos del salario: indemnizaciones, seguros por muerte, primas de costo de vida, apoyos económicos.',
  },
  { id: 'alimentacion', text: '¿Su empleador pagó a terceros por su alimentación?', hint: 'Pagos a terceros por concepto de alimentación del trabajador o su familia.', advanced: true },
  { id: 'independiente', text: '¿Recibió honorarios o ingresos por servicios como independiente?', hint: 'Contratos de prestación de servicios, comisiones, actividad propia.' },
  { id: 'pension', text: '¿Recibió una pensión?' },
  { id: 'intereses', text: '¿Recibió intereses o rendimientos financieros?', hint: 'CDT, cuentas de ahorro, fondos, bonos.' },
  { id: 'arriendos', text: '¿Recibió arriendos, regalías u otras rentas de capital?' },
  { id: 'ventas', text: '¿Vendió mercancías o tuvo otros ingresos no laborales?', hint: 'Comercio, actividades no laborales, apoyos económicos.' },
  { id: 'dividendos', text: '¿Recibió dividendos o participaciones de sociedades?' },
  { id: 'venta_activos', text: '¿Vendió inmuebles, acciones, vehículos u otros bienes?' },
  { id: 'herencias', text: '¿Recibió herencias, legados, donaciones o gananciales?' },
  { id: 'premios', text: '¿Ganó loterías, rifas, apuestas o premios?' },
  { id: 'seguros', text: '¿Recibió indemnizaciones por seguros de vida?' },
  { id: 'cuentas', text: '¿Tenía dinero en bancos o efectivo en Colombia a 31 de diciembre de 2025?' },
  { id: 'inversiones', text: '¿Tenía acciones, fondos u otras inversiones en Colombia?' },
  { id: 'activos_fijos', text: '¿Tenía inmuebles, vehículos u otros activos fijos?' },
  { id: 'exterior', text: '¿Tenía bienes, cuentas o deudas en el exterior o en moneda extranjera?' },
  { id: 'otros_activos', text: '¿Tenía otros bienes o derechos?', hint: 'Cuentas por cobrar, criptoactivos, derechos fiduciarios, inventarios.' },
  { id: 'deudas', text: '¿Tenía deudas en Colombia a 31 de diciembre de 2025?', hint: 'Créditos, tarjetas, hipotecas, leasing.' },
  { id: 'vivienda', text: '¿Pagó intereses de crédito de vivienda o leasing habitacional?' },
  { id: 'salud', text: '¿Pagó medicina prepagada o seguros de salud?' },
  { id: 'icetex', text: '¿Pagó intereses de un crédito educativo del ICETEX?' },
  { id: 'aportes_voluntarios', text: '¿Hizo aportes voluntarios a pensiones, AFC o AVC?' },
  { id: 'gmf', text: '¿Quiere deducir el 4x1000 (GMF) que pagó?' },
  { id: 'facturas', text: '¿Hizo compras con factura electrónica?', hint: 'Deducción del 1 % de las compras soportadas con factura electrónica.' },
  { id: 'impuestos_exterior', text: '¿Pagó impuestos en el exterior?' },
  { id: 'donaciones', text: '¿Hizo donaciones o financió becas con beneficio tributario?' },
  { id: 'perdidas', text: '¿Tiene pérdidas fiscales de años anteriores por compensar?', advanced: true },
  { id: 'ece', text: '¿Tiene rentas pasivas de entidades controladas del exterior (ECE)?', advanced: true },
  { id: 'inversiones_especiales', text: '¿Hizo inversiones con deducción especial?', hint: 'Centros de reclusión, obras audiovisuales, librerías, cine, escenarios, vehículos eléctricos.', advanced: true },
  { id: 'correcciones', text: '¿Debe incluir activos omitidos o retirar deudas inexistentes de años anteriores?', advanced: true },
  { id: 'otros_descuentos', text: '¿Tiene descuento por IVA de activos fijos reales productivos?', advanced: true },
  { id: 'exentas', text: '¿Tiene otras rentas exentas o rentas líquidas gravables especiales?', advanced: true },
];

export const GROUPS: GroupDef[] = [
  {
    id: 'datos',
    title: 'Sus datos',
    pages: [
      {
        id: 'datos-generales',
        title: 'Datos generales',
        blurb: 'Identificación, dependientes y fecha de presentación.',
        sheets: [{ sheet: 'DatosGenerales' }],
      },
    ],
  },
  {
    id: 'patrimonio',
    title: 'Patrimonio',
    pages: [
      { id: 'cuentas', title: 'Bancos y efectivo', blurb: 'Saldos en cuentas y efectivo en Colombia.', when: ['cuentas'], sheets: [{ sheet: 'Efectivo_Bancos_Cuentas' }] },
      { id: 'inversiones', title: 'Inversiones', blurb: 'Acciones, cuotas partes y otras inversiones.', when: ['inversiones'], sheets: [{ sheet: 'Inversiones' }] },
      { id: 'activos-fijos', title: 'Inmuebles, vehículos y activos fijos', blurb: 'Bienes raíces, vehículos y otros activos fijos.', when: ['activos_fijos'], sheets: [{ sheet: 'Activos_Fijos' }] },
      {
        id: 'otros-activos',
        title: 'Otros bienes',
        blurb: 'Otros activos e inventarios.',
        when: ['otros_activos'],
        sheets: [{ sheet: 'Otros_Activos' }, { sheet: 'Inventarios', title: 'Inventarios' }],
      },
      {
        id: 'exterior',
        title: 'Bienes y deudas en el exterior',
        blurb: 'Bienes, efectivo y deudas en moneda extranjera.',
        when: ['exterior'],
        sheets: [{ sheet: 'Bienes_Moneda_Extranjera', title: 'Bienes y efectivo' }, { sheet: 'Deudas_Moneda_Extranjera', title: 'Deudas' }],
      },
      { id: 'deudas', title: 'Deudas', blurb: 'Créditos y obligaciones en Colombia.', when: ['deudas'], sheets: [{ sheet: 'Deudas_Moneda_Nacional' }] },
      {
        id: 'correcciones',
        title: 'Activos omitidos y deudas inexistentes',
        blurb: 'Correcciones de años anteriores.',
        when: ['correcciones'],
        sheets: [
          { sheet: 'Activos_Omit_Nal', title: 'Activos omitidos en moneda nacional' },
          { sheet: 'Act_Omit_Ext', title: 'Activos omitidos en moneda extranjera' },
          { sheet: 'Deudas_Inex', title: 'Deudas inexistentes' },
        ],
      },
    ],
  },
  {
    id: 'ingresos',
    title: 'Ingresos',
    pages: [
      {
        id: 'salario',
        title: 'Salarios y pagos laborales',
        blurb: 'Ingresos de empleadores, cesantías y aportes; honorarios sin costos ni gastos.',
        // honorarios declared without costs (25 % exemption) are entered here, as in DIAN's file
        when: ['salario', 'independiente'],
        sheets: [
          { sheet: 'Salarios_Demas_Pagos_Laborales' },
          { sheet: 'Datos_Salarios', title: 'Preguntas sobre el salario' },
          { sheet: 'Datos_Cesantias', title: 'Preguntas sobre cesantías' },
          { sheet: 'Datos_Gastos_Rep', title: 'Preguntas sobre gastos de representación' },
          { sheet: 'Datos_Otros_Ingresos', title: 'Otros ingresos laborales', when: ['otros_laborales'] },
          { sheet: 'Pagos_terceros', title: 'Pagos a terceros por alimentación', when: ['alimentacion'] },
        ],
      },
      {
        id: 'independiente',
        title: 'Honorarios y trabajo independiente',
        blurb: 'Ingresos sin relación laboral, sus costos y gastos.',
        when: ['independiente'],
        guide: [
          'Los honorarios y pagos por servicios se registran en uno de tres lugares, según cómo los declare:',
          '• Sin costos ni gastos (usa la renta exenta del 25 %): en «Salarios y pagos laborales», fila «Ingresos por honorarios, prestación de servicios y otras rentas de trabajo sin costos ni gastos», una por contratante. Van a la casilla 32.',
          '• Con costos y gastos: en esta sección, «Ingresos por rentas de trabajo que no provengan de una relación laboral», con el nombre o NIT de quien pagó y el número de meses. Van a la casilla 43. Los ingresos del exterior tienen su propia tabla en esta misma sección, separada por países con y sin convenio para evitar la doble tributación.',
          '• Como rentas no laborales: en «Honorarios como renta no laboral». Van a la casilla 74.',
          'Un pago de un cliente del exterior recibido por una plataforma de pagos colombiana suele no tener retención ni aparecer en la información exógena, pero igual se declara. Si el servicio se prestó desde Colombia, puede ser de fuente nacional aunque el cliente esté afuera (artículo 24 del Estatuto Tributario): confirme con un contador en cuál tabla registrarlo.',
        ],
        sheets: [
          { sheet: 'Rentas_Trabajo_ Hon_Com' },
          { sheet: 'Hon_Com_Serv', title: 'Honorarios como renta no laboral' },
          { sheet: 'Ing_No_Const_Hon_Com', title: 'Ingresos no constitutivos de renta' },
          { sheet: 'Compras', title: 'Compras' },
          { sheet: 'Gastos_Personal', title: 'Gastos de personal' },
          { sheet: 'Gastos_Financieros', title: 'Gastos financieros' },
          { sheet: 'Deduccion_Impuestos', title: 'Impuestos pagados' },
          { sheet: 'Gastos_Arrendamie', title: 'Arrendamientos' },
          { sheet: 'Otros_costos', title: 'Otros costos y gastos' },
        ],
      },
      { id: 'pension', title: 'Pensiones', blurb: 'Pensiones de jubilación, invalidez, vejez o sobrevivientes.', when: ['pension'], sheets: [{ sheet: 'Pensiones' }] },
      {
        id: 'capital',
        title: 'Intereses, arriendos y otras rentas de capital',
        blurb: 'Rendimientos financieros, arrendamientos y regalías.',
        when: ['intereses', 'arriendos'],
        sheets: [
          { sheet: 'Inter_Rend_Finan', title: 'Intereses y rendimientos financieros' },
          { sheet: 'Otros_Ing_No_Rel', title: 'Arrendamientos, regalías y otros' },
          { sheet: 'Ing_No_Const_Renta_Cap', title: 'Ingresos no constitutivos de renta' },
        ],
      },
      {
        id: 'no-laborales',
        title: 'Ventas y otras rentas no laborales',
        blurb: 'Venta de mercancías, apoyos económicos y otros ingresos.',
        when: ['ventas'],
        sheets: [
          { sheet: 'Ventas' },
          { sheet: 'Apoyos_economicos', title: 'Apoyos económicos condonados' },
          { sheet: 'Ing_No_Const_Renta_No_Lab', title: 'Ingresos no constitutivos de renta' },
        ],
      },
      {
        id: 'dividendos',
        title: 'Dividendos y participaciones',
        blurb: 'Dividendos recibidos de sociedades nacionales y extranjeras.',
        when: ['dividendos'],
        sheets: [
          { sheet: 'Dividendos_Participaciones', title: 'Dividendos 2016 y anteriores' },
          { sheet: '1a_Subcédula', title: '1.ª subcédula (2017 en adelante)' },
          { sheet: '2a_Subcédula', title: '2.ª subcédula (2017 en adelante)' },
        ],
      },
      {
        id: 'ventas-activos',
        title: 'Venta de bienes',
        blurb: 'Venta de inmuebles, acciones y otros activos.',
        when: ['venta_activos'],
        sheets: [
          { sheet: 'Venta_Inm_Dif_Casa_Hab', title: 'Venta de inmuebles' },
          { sheet: 'Venta_Acciones_Aportes', title: 'Venta de acciones y aportes' },
          { sheet: 'Venta_Activos_Fijos', title: 'Venta de otros activos fijos' },
          { sheet: 'Venta_Casa_Antes_1987', title: 'Venta de casa adquirida antes de 1987' },
        ],
      },
      {
        id: 'herencias',
        title: 'Herencias, legados y gananciales',
        blurb: 'Asignaciones por causa de muerte, herencias y gananciales.',
        when: ['herencias'],
        sheets: [
          { sheet: 'Asignacion_Muerte_Porcion_Cony', title: 'Asignación por causa de muerte o porción conyugal' },
          { sheet: 'Herencia_Legado', title: 'Herencia o legado' },
          { sheet: 'Gananciales' },
        ],
      },
      {
        id: 'premios',
        title: 'Premios y loterías',
        blurb: 'Loterías, rifas, apuestas, títulos de capitalización.',
        when: ['premios'],
        sheets: [
          { sheet: 'Premios_Loterias_Etc', title: 'Loterías, rifas y apuestas' },
          { sheet: 'Premios_Titulos_capitalizacion', title: 'Títulos de capitalización' },
          { sheet: 'Premios_Apuestas_Hipicos', title: 'Apuestas y concursos hípicos o caninos' },
        ],
      },
      { id: 'seguros', title: 'Seguros de vida', blurb: 'Indemnizaciones por seguros de vida.', when: ['seguros'], sheets: [{ sheet: 'Seguros_Vida' }] },
      {
        id: 'otras-rentas',
        title: 'Otras rentas especiales',
        blurb: 'Rentas exentas, rentas líquidas gravables, sociedades liquidadas.',
        when: ['exentas'],
        sheets: [
          { sheet: 'Otros_Ing_Rentas_Exentas', title: 'Otros ingresos (rentas exentas)' },
          { sheet: 'Ren_Liq_Esp_Grav', title: 'Rentas líquidas gravables' },
          { sheet: 'Utilidades_Sociedades_Liquidada', title: 'Utilidades de sociedades liquidadas' },
        ],
      },
      {
        id: 'ece',
        title: 'Rentas pasivas ECE',
        blurb: 'Entidades controladas del exterior.',
        when: ['ece'],
        sheets: [
          { sheet: 'Rentas_pasivas_capital', title: 'Rentas de capital' },
          { sheet: 'Rentas_pasivas_no_Lab', title: 'Rentas no laborales' },
          { sheet: 'Rentas_pasivas_Div', title: 'Dividendos' },
        ],
      },
      { id: 'perdidas', title: 'Compensación de pérdidas', blurb: 'Pérdidas fiscales de años anteriores.', when: ['perdidas'], sheets: [{ sheet: 'COMPENSACIONES' }] },
    ],
  },
  {
    id: 'deducciones',
    title: 'Deducciones y beneficios',
    pages: [
      { id: 'vivienda', title: 'Intereses de vivienda', blurb: 'Créditos de vivienda y leasing habitacional.', when: ['vivienda'], sheets: [{ sheet: 'Deduccion_Vivienda' }] },
      { id: 'salud', title: 'Medicina prepagada y seguros de salud', blurb: 'Pagos de salud deducibles.', when: ['salud'], sheets: [{ sheet: 'Deduccion_Salud' }] },
      { id: 'icetex', title: 'Intereses ICETEX', blurb: 'Créditos educativos.', when: ['icetex'], sheets: [{ sheet: 'Deduccion_Int_ICETEX' }] },
      {
        id: 'aportes',
        title: 'Aportes voluntarios y cesantías',
        blurb: 'Pensiones voluntarias, AFC, AVC y aportes a cesantías.',
        when: ['aportes_voluntarios'],
        sheets: [{ sheet: 'APORTES AFC, AVC PEN', title: 'Aportes AFC, AVC y pensiones voluntarias' }, { sheet: 'Deduccion_Cesantias', title: 'Aportes a fondos de cesantías (independientes)' }],
      },
      { id: 'gmf', title: 'Gravamen a los movimientos financieros', blurb: '50 % del 4x1000 pagado.', when: ['gmf'], sheets: [{ sheet: 'Deducción GMF' }] },
      { id: 'facturas', title: 'Compras con factura electrónica', blurb: 'Deducción del 1 % de compras.', when: ['facturas'], sheets: [{ sheet: 'Comfacelec' }] },
      {
        id: 'inversiones-especiales',
        title: 'Inversiones con deducción especial',
        blurb: 'Centros de reclusión, cultura, cine, escenarios, vehículos eléctricos.',
        when: ['inversiones_especiales'],
        sheets: [
          { sheet: 'Centros_Reclus', title: 'Centros de reclusión' },
          { sheet: 'Obras_Audiovisuales', title: 'Obras audiovisuales' },
          { sheet: 'Deducc_Librerias', title: 'Librerías' },
          { sheet: 'Deducc_Cine', title: 'Proyectos cinematográficos' },
          { sheet: 'Proyectos_Escenarios', title: 'Escenarios de artes escénicas' },
          { sheet: 'Deduccion_Vehic', title: 'Vehículos eléctricos e híbridos' },
        ],
      },
    ],
  },
  {
    id: 'liquidacion',
    title: 'Liquidación',
    pages: [
      {
        id: 'impuestos-exterior',
        title: 'Impuestos pagados en el exterior',
        blurb: 'Descuentos por impuestos pagados en otros países.',
        when: ['impuestos_exterior'],
        sheets: [
          { sheet: 'Impuestos_Exteriortra', title: 'Rentas de trabajo y pensiones' },
          { sheet: 'Impuestos_Exteriorcanola', title: 'Rentas de capital y no laborales' },
          { sheet: 'Impuestos_Exteriordiv', title: 'Dividendos y participaciones' },
        ],
      },
      {
        id: 'donaciones',
        title: 'Donaciones y becas',
        blurb: 'Descuentos tributarios por donaciones y becas.',
        when: ['donaciones'],
        sheets: [{ sheet: 'DONACION', title: 'Donaciones' }, { sheet: 'BECAS', title: 'Becas por impuestos' }],
      },
      { id: 'otros-descuentos', title: 'Descuento por IVA en activos productivos', blurb: 'IVA de activos fijos reales productivos.', when: ['otros_descuentos'], sheets: [{ sheet: 'Otros_Descuentos' }] },
      {
        id: 'liquidacion',
        title: 'Renta presuntiva, anticipo y saldos',
        blurb: 'Renta presuntiva, saldo a favor y anticipo del año anterior.',
        sheets: [{ sheet: 'Renta_Presuntiva', title: 'Renta presuntiva' }, { sheet: 'Liquidacion_Privada', title: 'Anticipo y saldos del año anterior' }],
      },
      { id: 'pago', title: 'Pago', blurb: 'Valores a pagar, sanciones e intereses.', sheets: [{ sheet: 'Pagos' }] },
    ],
  },
];

export const ALL_PAGES = GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g })));
export const pageById = (id: string) => ALL_PAGES.find((p) => p.id === id);
