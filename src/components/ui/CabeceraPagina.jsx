// Cabecera común de los módulos de administración: título a la izquierda, datos (chips) a su lado
// y la acción principal a la derecha. Así todas las pantallas arrancan igual.
export default function CabeceraPagina({ titulo, sub, datos, acciones }) {
  return (
    <header className="pg-cab">
      <div className="pg-cab-txt">
        <h2>{titulo}</h2>
        {datos}
      </div>
      {acciones && <div className="pg-cab-acc">{acciones}</div>}
      {sub && <p className="pg-cab-sub">{sub}</p>}
    </header>
  )
}
