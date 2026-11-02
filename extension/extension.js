// Disco: en la barra de arriba, la portada de lo que está sonando. Si es música (Spotify, YouTube
// Music…) se ve como un disco que gira mientras suena; si es un video, como una miniatura quieta.
// Al picarle: portada grande, canción, artista, la barra para adelantar o atrasar y los botones de
// aleatorio, anterior, pausa, siguiente y repetir.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {escribir, irA, leer, pista, SIGUIENTE_REPETIR, tiempo} from './controles.js';

import {abortar, portadaLocal} from './portadas.js';
import {describir, Reproductores} from './reproductores.js';

const VUELTA = 5000; // ms por vuelta del disco
const REVISAR_POSICION = 1000; // ms, solo con el menú abierto
const ESPERA_SALTO = 300; // ms: al mover la barra con teclado o rueda, salta cuando dejas de moverla

// Portada redonda (disco con agujero) o rectangular (video). Gira con girar(true/false).
const Portada = GObject.registerClass(
class Portada extends St.Widget {
    _init(clase) {
        super._init({style_class: clase, layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.CENTER});
        this._clase = clase;
        this._icono = new St.Icon({icon_name: 'audio-x-generic-symbolic', style_class: `${clase}-icono`,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this._agujero = new St.Widget({style_class: `${clase}-agujero`,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._icono);
        this.add_child(this._agujero);
        this.set_pivot_point(0.5, 0.5);
        this._giro = new Clutter.PropertyTransition({property_name: 'rotation-angle-z', duration: VUELTA,
            repeat_count: -1, progress_mode: Clutter.AnimationMode.LINEAR});
        this._giro.set_from(0);
        this._giro.set_to(360);
        this._giro.set_remove_on_complete(false);
        this.add_transition('girar', this._giro);
        this._giro.stop();
    }

    // ruta: archivo local de la portada o null; gicon: ícono de la app si no hay portada.
    poner(ruta, gicon, musica) {
        this.style = ruta ? `background-image: url("${Gio.File.new_for_path(ruta).get_uri().replace(/"/g, '%22')}");` : null;
        this._icono.visible = !ruta;
        if (gicon)
            this._icono.gicon = gicon;
        else
            this._icono.icon_name = 'audio-x-generic-symbolic';
        this._agujero.visible = musica;
        this.style_class = `${this._clase} ${musica ? 'disco-musica' : 'disco-video'}`;
    }

    girar(si) {
        if (si && !this._giro.is_playing())
            this._giro.start();
        else if (!si && this._giro.is_playing())
            this._giro.pause();
    }

    // Video: sin giro y derecho.
    enderezar() {
        this._giro.stop();
        this.rotation_angle_z = 0;
    }
});

function boton(icono, nombre, clase, alPulsar) {
    const tam = {'disco-boton-play': 28, 'disco-boton-modo': 18}[clase] ?? 22;
    const b = new St.Button({style_class: `disco-boton ${clase}`, can_focus: true, accessible_name: nombre,
        child: new St.Icon({icon_name: icono, icon_size: tam})});
    b.connect('clicked', alPulsar);
    return b;
}

function etiqueta(clase) {
    const l = new St.Label({style_class: clase, x_align: Clutter.ActorAlign.CENTER});
    l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return l;
}

const Indicador = GObject.registerClass(
class Indicador extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Disco');
        this._chica = new Portada('disco-icono');
        this.add_child(this._chica);
        this.menu.box.add_style_class_name('disco-menu-caja');

        // Portada grande, textos y controles.
        const fija = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const caja = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'disco-menu', x_expand: true});
        this._grande = new Portada('disco-portada');
        this._titulo = etiqueta('disco-titulo');
        this._artista = etiqueta('disco-artista');
        this._app = etiqueta('disco-app');
        // Barra de la canción con el tiempo transcurrido y el total.
        this._progreso = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'disco-progreso', x_expand: true});
        this._barra = new Slider(0);
        this._barra.accessible_name = 'Posición de la canción';
        const tiempos = new St.BoxLayout({x_expand: true});
        this._transcurrido = new St.Label({style_class: 'disco-tiempo', text: '0:00'});
        this._total = new St.Label({style_class: 'disco-tiempo', text: '0:00', x_expand: true, x_align: Clutter.ActorAlign.END});
        tiempos.add_child(this._transcurrido);
        tiempos.add_child(this._total);
        this._progreso.add_child(this._barra);
        this._progreso.add_child(tiempos);
        this._arrastrando = false;
        this._poniendo = false;
        this._barra.connect('drag-begin', () => {
            this._arrastrando = true;
        });
        this._barra.connect('drag-end', () => {
            this._arrastrando = false;
            this._saltar();
        });
        this._barra.connect('notify::value', () => {
            const {largo} = this._actual ? pista(this._actual) : {largo: 0};
            this._transcurrido.text = tiempo(this._barra.value * largo);
            if (!this._poniendo && !this._arrastrando)
                this._saltarLuego(); // teclado o rueda del ratón
        });

        const controles = new St.BoxLayout({style_class: 'disco-controles', x_align: Clutter.ActorAlign.CENTER});
        this._aleatorio = boton('media-playlist-shuffle-symbolic', 'Aleatorio', 'disco-boton-modo', () => {
            if (this._actual && this._modo.aleatorio !== null)
                escribir(this._actual, 'Shuffle', GLib.Variant.new_boolean(!this._modo.aleatorio)).then(() => this._revisar());
        });
        this._repetir = boton('media-playlist-repeat-symbolic', 'Repetir', 'disco-boton-modo', () => {
            if (this._actual && this._modo.repetir)
                escribir(this._actual, 'LoopStatus', GLib.Variant.new_string(SIGUIENTE_REPETIR[this._modo.repetir] ?? 'None')).then(() => this._revisar());
        });
        this._modo = {aleatorio: null, repetir: null, posicion: 0, sePuede: false};
        this._anterior = boton('media-skip-backward-symbolic', 'Anterior', 'disco-boton-chico', () => this._actual?.previous());
        this._pausa = boton('media-playback-start-symbolic', 'Reproducir o pausar', 'disco-boton-play', () => this._actual?.playPause());
        this._siguiente = boton('media-skip-forward-symbolic', 'Siguiente', 'disco-boton-chico', () => this._actual?.next());
        for (const b of [this._aleatorio, this._anterior, this._pausa, this._siguiente, this._repetir])
            controles.add_child(b);
        for (const a of [this._grande, this._titulo, this._artista, this._app, this._progreso, controles])
            caja.add_child(a);
        fija.add_child(caja);
        this.menu.addMenuItem(fija);

        this._otros = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._otros);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._abrir = new PopupMenu.PopupImageMenuItem('Abrir', 'window-new-symbolic');
        this._abrir.connect('activate', () => this._actual?.raise());
        this.menu.addMenuItem(this._abrir);

        this._actual = null;
        this._portadaUrl = null;
        this._reproductores = new Reproductores();
        this._reproductores.connectObject('cambio', () => this._sincronizar(), this);
        this._reloj = 0;
        this._espera = 0;
        this.menu.connectObject('open-state-changed', (_m, abierto) => {
            if (abierto) {
                this._pausa.grab_key_focus();
                this._revisar();
                this._reloj = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REVISAR_POSICION, () => {
                    this._revisar();
                    return GLib.SOURCE_CONTINUE;
                });
            } else {
                this._pararReloj();
            }
        }, this);
        this._sincronizar();
    }

    _sincronizar() {
        const r = this._actual = this._reproductores.actual;
        this.visible = Boolean(r);
        if (!r) {
            this.menu.close();
            return;
        }
        const d = describir(r);
        this._titulo.text = d.titulo || d.app;
        this._artista.text = d.artista || (d.album ? d.album : '');
        this._artista.visible = Boolean(this._artista.text);
        this._app.text = d.titulo ? d.app : '';
        this._app.visible = Boolean(this._app.text);
        this._pausa.child.icon_name = d.sonando ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._pausa.accessible_name = d.sonando ? 'Pausar' : 'Reproducir';
        this._anterior.reactive = d.puedeAnterior;
        this._siguiente.reactive = d.puedeSiguiente;
        this._abrir.label.text = `Abrir ${d.app}`;
        this._abrir.setIcon(d.gicon ?? Gio.ThemedIcon.new('window-new-symbolic'));
        this.accessible_name = d.titulo ? `Sonando: ${d.titulo}${d.artista ? ` de ${d.artista}` : ''}` : 'Disco';

        if (d.portada !== this._portadaUrl) {
            this._portadaUrl = d.portada;
            this._ponerPortada(null, d); // mientras llega, el ícono de la app
            portadaLocal(d.portada).then(ruta => {
                if (this._portadaUrl === d.portada && ruta)
                    this._ponerPortada(ruta, d);
            });
        } else {
            this._ponerPortada(this._ruta, d);
        }
        this._otrosReproductores(r);
        if (this.menu.isOpen)
            this._revisar();
    }

    // Pregunta al reproductor posición, aleatorio y repetir (Spotify no avisa cuando cambian).
    async _revisar() {
        const r = this._actual;
        if (!r)
            return;
        const [posicion, aleatorio, repetir, sePuede] = await Promise.all(
            ['Position', 'Shuffle', 'LoopStatus', 'CanSeek'].map(p => leer(r, p)));
        if (r !== this._actual || !this._barra)
            return; // cambió de reproductor o se apagó la extensión mientras tanto
        const {largo} = pista(r);
        this._modo = {aleatorio: typeof aleatorio === 'boolean' ? aleatorio : null,
            repetir: typeof repetir === 'string' ? repetir : null, posicion: Number(posicion ?? 0),
            sePuede: sePuede !== false && largo > 0 && posicion !== null};

        this._progreso.visible = largo > 0 && posicion !== null;
        this._barra.reactive = this._barra.can_focus = this._modo.sePuede;
        this._total.text = tiempo(largo);
        if (!this._arrastrando && !this._espera) {
            this._poniendo = true;
            this._barra.value = largo > 0 ? Math.min(1, this._modo.posicion / largo) : 0;
            this._poniendo = false;
            this._transcurrido.text = tiempo(this._modo.posicion);
        }

        this._aleatorio.visible = this._modo.aleatorio !== null;
        this._ponerActivo(this._aleatorio, this._modo.aleatorio);
        this._aleatorio.accessible_name = this._modo.aleatorio ? 'Aleatorio: activado' : 'Aleatorio: desactivado';
        this._repetir.visible = this._modo.repetir !== null;
        this._repetir.child.icon_name = this._modo.repetir === 'Track' ? 'media-playlist-repeat-song-symbolic' : 'media-playlist-repeat-symbolic';
        this._ponerActivo(this._repetir, this._modo.repetir && this._modo.repetir !== 'None');
        this._repetir.accessible_name = {Playlist: 'Repetir: lista', Track: 'Repetir: esta canción'}[this._modo.repetir] ?? 'Repetir: desactivado';
    }

    _ponerActivo(b, si) {
        if (si)
            b.add_style_class_name('disco-activo');
        else
            b.remove_style_class_name('disco-activo');
    }

    _saltar() {
        const r = this._actual;
        if (!r || !this._modo.sePuede)
            return;
        const {largo} = pista(r);
        irA(r, this._barra.value * largo, this._modo.posicion).then(() => this._revisar());
    }

    _saltarLuego() {
        if (this._espera)
            GLib.source_remove(this._espera);
        this._espera = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ESPERA_SALTO, () => {
            this._espera = 0;
            this._saltar();
            return GLib.SOURCE_REMOVE;
        });
    }

    _pararReloj() {
        for (const id of [this._reloj, this._espera]) {
            if (id)
                GLib.source_remove(id);
        }
        this._reloj = this._espera = 0;
    }

    _ponerPortada(ruta, d) {
        this._ruta = ruta;
        for (const p of [this._chica, this._grande]) {
            p.poner(ruta, d.gicon, d.musica);
            if (d.musica)
                p.girar(d.sonando);
            else
                p.enderezar();
        }
    }

    // Si hay varios reproductores (Spotify y un video en Brave), se puede cambiar cuál se muestra.
    _otrosReproductores(actual) {
        this._otros.removeAll();
        const otros = this._reproductores.todos.filter(r => r !== actual);
        if (otros.length === 0)
            return;
        this._otros.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('También suena'));
        for (const r of otros) {
            const d = describir(r);
            const item = new PopupMenu.PopupImageMenuItem(`${d.app}: ${d.titulo || 'sin título'}`,
                d.sonando ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic');
            item.connect('activate', () => {
                this._reproductores.elegido = r;
                this._sincronizar();
                return true;
            });
            this._otros.addMenuItem(item);
        }
    }

    destroy() {
        this._pararReloj();
        this._reproductores.disconnectObject(this);
        this._reproductores.destroy();
        abortar();
        super.destroy();
    }
});

export default class Disco extends Extension {
    enable() {
        this._indicador = new Indicador();
        // A la izquierda, al final: junto a las otras extensiones.
        Main.panel.addToStatusArea(this.uuid, this._indicador, -1, 'left');
    }

    disable() {
        this._indicador?.destroy();
        this._indicador = null;
    }
}
