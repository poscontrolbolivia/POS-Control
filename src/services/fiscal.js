// Datos fiscales OPCIONALES del cliente (nombre, número de identificación y correo).
// Solo se guardan en la cuenta y salen en el comprobante; NO emiten factura. El nombre del
// identificador (NIT, RUT, RFC…) lo elige cada negocio en Configuración (config.fiscalEtiqueta).
export const etiquetaFiscal = config => String(config?.fiscalEtiqueta || '').trim() || 'NIT'
export const pideDatosFiscales = config => config?.datosFiscales !== false
export const correoValido = v => { const x = String(v || '').trim(); return !x || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x) }

export const fiscalDe = c => ({ nombre: c?.fiscalNombre || '', numero: c?.fiscalNumero || '', correo: c?.fiscalCorreo || '' })
export const fiscalVacio = f => !(f && (String(f.nombre || '').trim() || String(f.numero || '').trim() || String(f.correo || '').trim()))
export const fiscalIgual = (a, b) => ['nombre', 'numero', 'correo'].every(k => String(a?.[k] || '').trim() === String(b?.[k] || '').trim())
// Campos de la cuenta que se copian a la cuenta ya cobrada que se manda a imprimir.
export const fiscalACuenta = f => ({ fiscalNombre: String(f?.nombre || '').trim(), fiscalNumero: String(f?.numero || '').trim(), fiscalCorreo: String(f?.correo || '').trim() })
