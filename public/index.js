const socket = io();

const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150"><rect width="150" height="150" fill="%23142821"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="48" fill="%23f5c451">♫</text></svg>';

// Elementos de reproducción actual
const portadaActualEl = document.getElementById('movil-portada-actual');
const cancionActualEl = document.getElementById('movil-cancion-actual');
const artistaActualEl = document.getElementById('movil-artista-actual');
const pedidaPorEl = document.getElementById('movil-pedida-por');

// Elementos del formulario
const inputNombre = document.getElementById('input-nombre');
const inputNota = document.getElementById('input-nota');
const inputBusqueda = document.getElementById('input-busqueda');
const btnBuscar = document.getElementById('btn-buscar');
const resultadosEl = document.getElementById('resultados-busqueda');
const mensajeEstadoEl = document.getElementById('mensaje-estado');

// Elementos de la lista de espera
const contadorColaEl = document.getElementById('contador-cola');
const listaEsperaEl = document.getElementById('lista-espera');

portadaActualEl.src = PLACEHOLDER_IMG;

// Guarda una copia local del estado para saber después de quién queda el pedido
let estadoLocal = { actual: null, cola: [] };

// Recupera el nombre si el usuario ya había escrito uno antes
const nombreGuardado = localStorage.getItem('cubo_navidad_nombre');
if (nombreGuardado) {
    inputNombre.value = nombreGuardado;
}

// --- BÚSQUEDA EN SPOTIFY ---
async function ejecutarBusqueda() {
    const consulta = inputBusqueda.value.trim();
    if (!consulta) {
        inputBusqueda.focus();
        return;
    }

    btnBuscar.disabled = true;
    btnBuscar.textContent = '...';
    resultadosEl.innerHTML = '';

    try {
        const res = await fetch(`/api/buscar?q=${encodeURIComponent(consulta)}`);
        const canciones = await res.json();

        if (!res.ok) {
            throw new Error(canciones.error || 'Error al buscar');
        }

        if (canciones.length === 0) {
            const sinResultados = document.createElement('p');
            sinResultados.className = 'cola-vacia';
            sinResultados.textContent = 'No se encontraron canciones con ese nombre.';
            resultadosEl.appendChild(sinResultados);
            return;
        }

        canciones.forEach((cancion) => {
            const card = document.createElement('div');
            card.className = 'resultado-item';

            const img = document.createElement('img');
            img.src = cancion.imagen || PLACEHOLDER_IMG;
            img.alt = cancion.nombre;

            const info = document.createElement('div');
            info.className = 'resultado-info';

            const titulo = document.createElement('strong');
            titulo.textContent = cancion.nombre;

            const artista = document.createElement('span');
            artista.textContent = cancion.artista;

            info.appendChild(titulo);
            info.appendChild(artista);

            const btnPedir = document.createElement('button');
            btnPedir.type = 'button';
            btnPedir.className = 'btn-elegir';
            btnPedir.textContent = 'Pedir';
            btnPedir.addEventListener('click', () => enviarPedido(cancion));

            card.appendChild(img);
            card.appendChild(info);
            card.appendChild(btnPedir);
            resultadosEl.appendChild(card);
        });
    } catch (error) {
        mensajeEstadoEl.textContent = 'No se pudo conectar con el buscador. Intenta de nuevo.';
    } finally {
        btnBuscar.disabled = false;
        btnBuscar.textContent = 'Buscar';
    }
}

btnBuscar.addEventListener('click', ejecutarBusqueda);
inputBusqueda.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        ejecutarBusqueda();
    }
});

// --- ENVÍO DE SOLICITUD ---
function enviarPedido(cancion) {
    const nombre = inputNombre.value.trim();
    const nota = inputNota.value.trim();

    if (!nombre) {
        mensajeEstadoEl.textContent = 'Por favor escribe tu nombre antes de elegir una canción.';
        inputNombre.focus();
        return;
    }

    localStorage.setItem('cubo_navidad_nombre', nombre);

    // Calcula el turno exacto antes de enviar el evento
    let textoTurno = '';
    if (estadoLocal.cola.length > 0) {
        const personaAnterior = estadoLocal.cola[estadoLocal.cola.length - 1].nombre;
        textoTurno = `¡Listo! "${cancion.nombre}" quedó en lista. Vas después de ${personaAnterior}.`;
    } else if (estadoLocal.actual && estadoLocal.actual.modo === 'pedido') {
        textoTurno = `¡Listo! "${cancion.nombre}" es la siguiente. Vas después de ${estadoLocal.actual.nombre}.`;
    } else {
        textoTurno = `¡Listo! "${cancion.nombre}" empezará a sonar en unos segundos.`;
    }

    socket.emit('nuevo_pedido', {
        nombre,
        nota,
        cancion
    });

    // Limpia el buscador y la nota para evitar envíos duplicados accidentales
    resultadosEl.innerHTML = '';
    inputBusqueda.value = '';
    inputNota.value = '';
    mensajeEstadoEl.textContent = textoTurno;
}

// --- ACTUALIZACIÓN EN TIEMPO REAL ---
socket.on('estado_actualizado', ({ actual, cola }) => {
    estadoLocal = { actual, cola };

    // 1. Actualiza tarjeta "Sonando ahora"
    if (actual && actual.cancion) {
        portadaActualEl.src = actual.cancion.imagen || PLACEHOLDER_IMG;
        cancionActualEl.textContent = actual.cancion.nombre;
        artistaActualEl.textContent = actual.cancion.artista;
        pedidaPorEl.textContent = actual.modo === 'pedido'
            ? `Pedida por: ${actual.nombre}`
            : 'Música navideña del salón';
    } else {
        portadaActualEl.src = PLACEHOLDER_IMG;
        cancionActualEl.textContent = 'Esperando música...';
        artistaActualEl.textContent = '';
        pedidaPorEl.textContent = '';
    }

    // 2. Actualiza lista de espera ("Después de quién van")
    contadorColaEl.textContent = cola.length;
    listaEsperaEl.innerHTML = '';

    if (cola.length === 0) {
        const vacio = document.createElement('p');
        vacio.className = 'cola-vacia';
        vacio.textContent = 'No hay canciones en espera. ¡Tu canción sonará de inmediato!';
        listaEsperaEl.appendChild(vacio);
        return;
    }

    cola.forEach((item) => {
        const li = document.createElement('li');
        const contenedor = document.createElement('div');
        contenedor.className = 'resultado-info';

        const cancionTxt = document.createElement('strong');
        cancionTxt.textContent = `${item.cancion.nombre} — ${item.cancion.artista}`;

        const usuarioTxt = document.createElement('span');
        usuarioTxt.textContent = `Pedida por: ${item.nombre}`;

        contenedor.appendChild(cancionTxt);
        contenedor.appendChild(usuarioTxt);
        li.appendChild(contenedor);
        listaEsperaEl.appendChild(li);
    });
});