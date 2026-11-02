// Lo que GNOME no trae en su MprisPlayer: posición de la canción, saltar a un punto, aleatorio y
// repetir. Habla directo con el reproductor por D-Bus (org.mpris.MediaPlayer2.Player).
// Spotify no avisa cuando avanza la posición, así que se pregunta (solo con el menú abierto).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const RUTA = '/org/mpris/MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';
const PROPS = 'org.freedesktop.DBus.Properties';

function llamar(bus, interfaz, metodo, params, tipo = null) {
    return new Promise((resolver, rechazar) => {
        Gio.DBus.session.call(bus, RUTA, interfaz, metodo, params, tipo, Gio.DBusCallFlags.NONE, 2000, null,
            (con, res) => {
                try {
                    resolver(con.call_finish(res));
                } catch (e) {
                    rechazar(e);
                }
            });
    });
}

// Valor de una propiedad del reproductor, o null si no la tiene.
export async function leer(r, prop) {
    try {
        const res = await llamar(r._busName, PROPS, 'Get', new GLib.Variant('(ss)', [PLAYER, prop]),
            new GLib.VariantType('(v)'));
        return res.deepUnpack()[0].deepUnpack();
    } catch {
        return null;
    }
}

export function escribir(r, prop, variante) {
    return llamar(r._busName, PROPS, 'Set', new GLib.Variant('(ssv)', [PLAYER, prop, variante]))
        .catch(e => console.warn(`Disco: no pude cambiar ${prop}: ${e.message}`));
}

// Datos de la pista que no da GNOME: id (para saltar) y duración en microsegundos.
export function pista(r) {
    const m = r._playerProxy?.Metadata ?? {};
    const id = m['mpris:trackid']?.deepUnpack?.() ?? null;
    const largo = Number(m['mpris:length']?.deepUnpack?.() ?? 0);
    return {id, largo};
}

// Saltar a «micros» desde el inicio de la pista. SetPosition necesita el id de la pista; si no es
// una ruta D-Bus válida, se usa Seek (salto relativo) desde la posición actual.
export async function irA(r, micros, actual) {
    const {id} = pista(r);
    const destino = Math.max(0, Math.round(micros));
    if (id && GLib.Variant.is_object_path(id)) {
        await llamar(r._busName, PLAYER, 'SetPosition', new GLib.Variant('(ox)', [id, destino]))
            .catch(e => console.warn(`Disco: no pude adelantar: ${e.message}`));
    } else {
        await llamar(r._busName, PLAYER, 'Seek', new GLib.Variant('(x)', [destino - Math.round(actual)]))
            .catch(e => console.warn(`Disco: no pude adelantar: ${e.message}`));
    }
}

// Repetir: None → Playlist → Track → None.
export const SIGUIENTE_REPETIR = {None: 'Playlist', Playlist: 'Track', Track: 'None'};

// 83000000 µs → "1:23"
export function tiempo(micros) {
    const s = Math.max(0, Math.floor(micros / 1e6));
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, seg = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${seg}` : `${m}:${seg}`;
}
