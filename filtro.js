// Lista de palabras no aptas (puedes agregar o quitar las que necesites)
const PALABRAS_PROHIBIDAS = [
    'puta', 'puto', 'putas', 'putos', 'mierda', 'pendejo', 'pendeja',
    'cerote', 'cerotes', 'culero', 'culera', 'verga', 'vergas', 'vergon',
    'hijueputa', 'cabron', 'cabrona', 'malparido', 'malparida', 'maricon',
    'joto', 'pija', 'pijazo', 'culo', 'cagar', 'cagada', 'estupido',
    'estupida', 'idiota', 'imbecil', 'bastardo', 'zorra', 'perra',
    'mamawebos', 'mamaguevo', 'pene', 'vagina', 'sexo', 'porno'
];

// Construye una expresión regular que ignora mayúsculas/minúsculas y respeta límites de palabra
const regexCensura = new RegExp(`\\b(${PALABRAS_PROHIBIDAS.join('|')})\\b`, 'gi');

function limpiarTexto(texto, maxLongitud = 100) {
    if (!texto || typeof texto !== 'string') return '';

    // 1. Recorta espacios extra y limita la longitud máxima
    let limpio = texto.trim().slice(0, maxLongitud);

    // 2. Evita inyección de HTML en las pantallas TV
    limpio = limpio.replace(/</g, '<').replace(/>/g, '>');

    // 3. Reemplaza cada palabra prohibida por asteriscos del mismo largo
    limpio = limpio.replace(regexCensura, (coincidencia) => '*'.repeat(coincidencia.length));

    return limpio;
}

module.exports = {
    limpiarTexto
};