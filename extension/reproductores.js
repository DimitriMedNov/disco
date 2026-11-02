// Qué está sonando: usa los reproductores que GNOME ya detecta (MPRIS, el estándar con el que
// Spotify, Brave, Firefox, Rhythmbox y otros avisan qué tocan) y elige cuál mostrar.

import GObject from 'gi://GObject';

import * as Mpris from 'resource:///org/gnome/shell/ui/mpris.js';

// Apps de música: su portada gira como disco. Lo demás (YouTube, Netflix, videos) se ve quieto.
const APPS_MUSICA = /spotify|rhythmbox|amberol|lollypop|elisa|strawberry|clementine|audacious|quodlibet|gnome-music|tauon|cider|deezer|tidal|g4music|gapless|euphonica|mpd|cmus|ncspot|spot\b/i;
const WEB_MUSICA = /(music\.youtube\.com|open\.spotify\.com|soundcloud\.com|deezer\.com|tidal\.com|bandcamp\.com|music\.apple\.com|music\.amazon)/i;

function metadatos(reproductor) {
    const m = {};
    try {
        for (const [clave, valor] of Object.entries(reproductor._playerProxy?.Metadata ?? {}))
            m[clave] = valor.deepUnpack();
    } catch {
        // metadatos raros: se queda con lo que da GNOME
    }
    return m;
}

// "org.mpris.MediaPlayer2.spotify" → "Spotify" (cuando la app no tiene ícono instalado).
function nombreBonito(bus) {
    const n = bus.replace('org.mpris.MediaPlayer2.', '').replace(/\.instance.*$/, '');
    return n.charAt(0).toUpperCase() + n.slice(1);
}

// Lo que la barra necesita saber de un reproductor.
export function describir(r) {
    const m = metadatos(r);
    const url = typeof m['xesam:url'] === 'string' ? m['xesam:url'] : '';
    const album = typeof m['xesam:album'] === 'string' ? m['xesam:album'] : '';
    const nombre = r._busName ?? '';
    const app = r.app?.get_id() ?? '';
    const musica = APPS_MUSICA.test(nombre) || APPS_MUSICA.test(app) || WEB_MUSICA.test(url) || album.trim() !== '';
    const artistas = (r.trackArtists ?? []).filter(a => a && a !== 'Unknown artist' && a !== 'Artista desconocido');
    return {
        titulo: r.trackTitle && r.trackTitle !== 'Unknown title' ? r.trackTitle : '',
        artista: artistas.join(', '),
        album,
        portada: r.trackCoverUrl ?? '',
        app: r.app?.get_name() ?? nombreBonito(nombre),
        gicon: r.app?.get_icon() ?? null,
        musica,
        sonando: r.status === 'Playing',
        puedeAnterior: Boolean(r.canGoPrevious),
        puedeSiguiente: Boolean(r.canGoNext),
    };
}

// Lleva la lista de reproductores y avisa ('cambio') cuando cambia algo del que se muestra.
// Muestra el que está sonando; si ninguno suena, el último que sonó.
export const Reproductores = GObject.registerClass({
    Signals: {'cambio': {}},
}, class Reproductores extends GObject.Object {
    _init() {
        super._init();
        this._fuente = new Mpris.MprisSource();
        this._ultimoSonando = new Map(); // reproductor → momento en que sonó por última vez
        this.elegido = null; // el que eligió la persona en el menú (si hay varios)
        this._fuente.connectObject(
            'player-added', (_f, r) => this._agregar(r),
            'player-removed', (_f, r) => {
                r.disconnectObject(this);
                this._ultimoSonando.delete(r);
                if (this.elegido === r)
                    this.elegido = null;
                this.emit('cambio');
            }, this);
        for (const r of this._fuente.players)
            this._agregar(r);
    }

    _agregar(r) {
        r.connectObject('changed', () => {
            if (r.status === 'Playing') {
                this._ultimoSonando.set(r, Date.now());
                // Si empieza a sonar otro, ese pasa al frente.
                if (this.elegido && this.elegido !== r && this.elegido.status !== 'Playing')
                    this.elegido = null;
            }
            this.emit('cambio');
        }, this);
        if (r.status === 'Playing')
            this._ultimoSonando.set(r, Date.now());
        this.emit('cambio');
    }

    get todos() {
        return this._fuente.players;
    }

    get actual() {
        const lista = this.todos;
        if (this.elegido && lista.includes(this.elegido))
            return this.elegido;
        return lista.find(r => r.status === 'Playing') ??
            [...lista].sort((a, b) => (this._ultimoSonando.get(b) ?? 0) - (this._ultimoSonando.get(a) ?? 0))[0] ?? null;
    }

    destroy() {
        this._fuente.disconnectObject(this);
        for (const r of this._fuente.players)
            r.disconnectObject(this);
        this._ultimoSonando.clear();
    }
});
