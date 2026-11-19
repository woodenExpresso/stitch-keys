"""
Stitch Keys — Macro Recorder
Records keyboard and mouse events globally, exports to JSON.
Requires: pip install pynput
"""

import tkinter as tk
from tkinter import font as tkfont, filedialog, messagebox
import json
import time
import threading
import sys

try:
    from pynput import keyboard, mouse as pmouse
    PYNPUT_OK = True
except ImportError:
    PYNPUT_OK = False

# ── Colour palette matching Stitch Keys ─────────────────────────────────────
BG       = '#0f1e24'
SURFACE  = '#162830'
BORDER   = '#1f3540'
TEXT     = '#d4d8e0'
MUTED    = '#6a7a88'
ACCENT   = '#7390b9'
RED      = '#e05050'
RED_DIM  = '#7a2828'
GREEN    = '#44cc88'
AMBER    = '#c9882a'

# ── Helpers ──────────────────────────────────────────────────────────────────

def fmt_key(key):
    """Return a human-readable string for a pynput key."""
    try:
        # Regular character key
        return key.char.upper() if key.char else str(key)
    except AttributeError:
        name = str(key).replace('Key.', '')
        mapping = {
            'ctrl_l': 'Ctrl', 'ctrl_r': 'Ctrl',
            'alt_l': 'Alt',   'alt_r': 'Alt',
            'shift':  'Shift', 'shift_r': 'Shift',
            'cmd':    'Meta',  'cmd_r': 'Meta',
            'space':  'Space', 'enter': 'Enter',
            'backspace': 'Backspace', 'delete': 'Delete',
            'tab': 'Tab', 'esc': 'Esc',
            'up': '↑', 'down': '↓', 'left': '←', 'right': '→',
            'f1':'F1','f2':'F2','f3':'F3','f4':'F4','f5':'F5','f6':'F6',
            'f7':'F7','f8':'F8','f9':'F9','f10':'F10','f11':'F11','f12':'F12',
        }
        return mapping.get(name, name.capitalize())

def build_combo(key, pressed_mods):
    """Build 'Ctrl+Shift+C' style string."""
    base = fmt_key(key)
    if base in ('Ctrl', 'Alt', 'Shift', 'Meta'):
        return None          # modifier-only press, skip
    parts = []
    if 'Ctrl'  in pressed_mods: parts.append('Ctrl')
    if 'Meta'  in pressed_mods: parts.append('Meta')
    if 'Alt'   in pressed_mods: parts.append('Alt')
    if 'Shift' in pressed_mods: parts.append('Shift')
    parts.append(base)
    return '+'.join(parts)

def fmt_button(btn):
    return str(btn).replace('Button.', '').capitalize()

# ── Main app ─────────────────────────────────────────────────────────────────

class MacroRecorder(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('Stitch Keys — Macro Recorder')
        self.configure(bg=BG)
        self.resizable(True, True)
        self.minsize(560, 440)

        self._recording   = False
        self._events      = []          # list of event dicts
        self._start_time  = 0.0
        self._pressed_mods = set()      # currently held modifier names
        self._kb_listener  = None
        self._ms_listener  = None
        self._last_mouse_move = 0.0     # throttle mousemove spam

        self._build_ui()
        self.protocol('WM_DELETE_WINDOW', self._on_close)

    # ── UI construction ───────────────────────────────────────────────────────

    def _build_ui(self):
        hdr_font   = tkfont.Font(family='Segoe UI', size=15, weight='bold')
        label_font = tkfont.Font(family='Segoe UI', size=9)
        btn_font   = tkfont.Font(family='Segoe UI', size=9, weight='bold')
        log_font   = tkfont.Font(family='Consolas', size=9)

        # Header
        hdr = tk.Frame(self, bg=SURFACE, pady=10)
        hdr.pack(fill='x')
        tk.Label(hdr, text='STITCH KEYS', font=hdr_font,
                 bg=SURFACE, fg=ACCENT).pack(side='left', padx=16)
        tk.Label(hdr, text='Macro Recorder', font=label_font,
                 bg=SURFACE, fg=MUTED).pack(side='left')

        # Toolbar
        toolbar = tk.Frame(self, bg=BG, pady=8, padx=12)
        toolbar.pack(fill='x')

        self._rec_btn = tk.Button(
            toolbar, text='● REC', font=btn_font, width=8,
            bg=RED_DIM, fg='#f07070', activebackground='#8a2020',
            relief='flat', bd=0, cursor='hand2',
            command=self._toggle_record)
        self._rec_btn.pack(side='left', padx=(0, 6))

        self._play_btn = tk.Button(
            toolbar, text='▶  PLAY', font=btn_font, width=8,
            bg=BORDER, fg=TEXT, activebackground='#2a4050',
            relief='flat', bd=0, cursor='hand2',
            command=self._play_back)
        self._play_btn.pack(side='left', padx=(0, 6))

        tk.Button(
            toolbar, text='Clear', font=btn_font, width=6,
            bg=BORDER, fg=MUTED, activebackground='#2a4050',
            relief='flat', bd=0, cursor='hand2',
            command=self._clear).pack(side='left', padx=(0, 6))

        tk.Button(
            toolbar, text='Export JSON', font=btn_font,
            bg=BORDER, fg=ACCENT, activebackground='#2a4050',
            relief='flat', bd=0, cursor='hand2',
            command=self._export).pack(side='right')

        # Status bar
        self._status_var = tk.StringVar(value='Ready — click ● REC to start')
        status = tk.Frame(self, bg=SURFACE, pady=4, padx=12)
        status.pack(fill='x')
        self._status_dot = tk.Label(status, text='●', font=label_font,
                                    bg=SURFACE, fg=MUTED, width=2)
        self._status_dot.pack(side='left')
        tk.Label(status, textvariable=self._status_var, font=label_font,
                 bg=SURFACE, fg=TEXT, anchor='w').pack(side='left')
        self._count_var = tk.StringVar(value='0 events')
        tk.Label(status, textvariable=self._count_var, font=label_font,
                 bg=SURFACE, fg=MUTED).pack(side='right')

        # Event log
        log_frame = tk.Frame(self, bg=BG, padx=12, pady=8)
        log_frame.pack(fill='both', expand=True)

        tk.Label(log_frame, text='CAPTURED EVENTS', font=label_font,
                 bg=BG, fg=MUTED).pack(anchor='w', pady=(0, 4))

        txt_frame = tk.Frame(log_frame, bg=BORDER, bd=1, relief='flat')
        txt_frame.pack(fill='both', expand=True)

        self._log = tk.Text(
            txt_frame, font=log_font, bg='#0a1820', fg=TEXT,
            insertbackground=ACCENT, selectbackground=ACCENT,
            relief='flat', bd=8, wrap='none', state='disabled',
            padx=4, pady=4)
        self._log.pack(side='left', fill='both', expand=True)

        sb = tk.Scrollbar(txt_frame, command=self._log.yview, bg=SURFACE)
        sb.pack(side='right', fill='y')
        self._log.configure(yscrollcommand=sb.set)

        # Tag colours for different event types
        self._log.tag_configure('time',  foreground=MUTED)
        self._log.tag_configure('key',   foreground='#b8cfe8')
        self._log.tag_configure('click', foreground=AMBER)
        self._log.tag_configure('move',  foreground='#5a7060')
        self._log.tag_configure('scroll',foreground='#8060a8')
        self._log.tag_configure('info',  foreground=MUTED)

        if not PYNPUT_OK:
            self._append_log('  pynput not installed — run:  pip install pynput\n', 'info')

    # ── Recording ─────────────────────────────────────────────────────────────

    def _toggle_record(self):
        if self._recording:
            self._stop_record()
        else:
            self._start_record()

    def _start_record(self):
        if not PYNPUT_OK:
            messagebox.showerror('Missing dependency',
                                 'Run:  pip install pynput\nthen restart.')
            return
        self._recording   = True
        self._start_time  = time.time()
        self._pressed_mods.clear()
        self._events      = []

        self._rec_btn.configure(text='■  STOP', bg='#8a2020', fg=RED)
        self._status_var.set('Recording — press shortcuts and click anywhere…')
        self._status_dot.configure(fg=RED)
        self._count_var.set('0 events')
        self._append_log(f'  ── Recording started ──\n', 'info')

        self._kb_listener = keyboard.Listener(
            on_press=self._on_key_press, on_release=self._on_key_release)
        self._ms_listener = pmouse.Listener(
            on_click=self._on_click, on_scroll=self._on_scroll,
            on_move=self._on_move)
        self._kb_listener.start()
        self._ms_listener.start()

    def _stop_record(self):
        self._recording = False
        if self._kb_listener:
            self._kb_listener.stop(); self._kb_listener = None
        if self._ms_listener:
            self._ms_listener.stop(); self._ms_listener = None

        self._rec_btn.configure(text='● REC', bg=RED_DIM, fg='#f07070')
        self._status_var.set(f'Stopped — {len(self._events)} events captured')
        self._status_dot.configure(fg=GREEN if self._events else MUTED)
        self._append_log(f'  ── Recording stopped  ({len(self._events)} events) ──\n', 'info')

    # ── pynput callbacks (called from background threads) ────────────────────

    def _elapsed(self):
        return time.time() - self._start_time

    def _on_key_press(self, key):
        if not self._recording:
            return
        name = fmt_key(key)
        if name in ('Ctrl', 'Alt', 'Shift', 'Meta'):
            self._pressed_mods.add(name)
            return
        combo = build_combo(key, self._pressed_mods)
        if not combo:
            return
        t = self._elapsed()
        ev = {'time': round(t * 1000), 'type': 'key', 'combo': combo}
        self._events.append(ev)
        self.after(0, self._log_key, t, combo)

    def _on_key_release(self, key):
        name = fmt_key(key)
        self._pressed_mods.discard(name)

    def _on_click(self, x, y, button, pressed):
        if not self._recording or not pressed:
            return
        t = self._elapsed()
        btn = fmt_button(button)
        ev = {'time': round(t * 1000), 'type': 'mouse_click',
              'x': x, 'y': y, 'button': btn.lower()}
        self._events.append(ev)
        self.after(0, self._log_click, t, x, y, btn)

    def _on_scroll(self, x, y, dx, dy):
        if not self._recording:
            return
        t = self._elapsed()
        ev = {'time': round(t * 1000), 'type': 'mouse_scroll',
              'x': x, 'y': y, 'dx': dx, 'dy': dy}
        self._events.append(ev)
        self.after(0, self._log_scroll, t, x, y, dy)

    def _on_move(self, x, y):
        if not self._recording:
            return
        now = time.time()
        if now - self._last_mouse_move < 0.25:   # log at most 4 moves/sec
            return
        self._last_mouse_move = now
        t = self._elapsed()
        ev = {'time': round(t * 1000), 'type': 'mouse_move', 'x': x, 'y': y}
        self._events.append(ev)
        self.after(0, self._log_move, t, x, y)

    # ── Log helpers (must run on main thread via after()) ─────────────────────

    def _append_log(self, text, tag=''):
        self._log.configure(state='normal')
        self._log.insert('end', text, tag)
        self._log.see('end')
        self._log.configure(state='disabled')

    def _log_key(self, t, combo):
        self._append_log(f'  {t:7.3f}s  ', 'time')
        self._append_log(f'KEY   {combo}\n', 'key')
        self._count_var.set(f'{len(self._events)} events')

    def _log_click(self, t, x, y, btn):
        self._append_log(f'  {t:7.3f}s  ', 'time')
        self._append_log(f'CLICK {btn:<6}  ({x}, {y})\n', 'click')
        self._count_var.set(f'{len(self._events)} events')

    def _log_scroll(self, t, x, y, dy):
        direction = '↑' if dy > 0 else '↓'
        self._append_log(f'  {t:7.3f}s  ', 'time')
        self._append_log(f'SCROLL {direction}  ({x}, {y})\n', 'scroll')
        self._count_var.set(f'{len(self._events)} events')

    def _log_move(self, t, x, y):
        self._append_log(f'  {t:7.3f}s  ', 'time')
        self._append_log(f'MOVE        ({x}, {y})\n', 'move')
        self._count_var.set(f'{len(self._events)} events')

    # ── Playback ──────────────────────────────────────────────────────────────

    def _play_back(self):
        if not self._events:
            messagebox.showinfo('Nothing to play', 'Record something first.')
            return
        if not PYNPUT_OK:
            messagebox.showerror('Missing dependency', 'pip install pynput')
            return
        if self._recording:
            messagebox.showwarning('Still recording', 'Stop recording first.')
            return
        threading.Thread(target=self._do_playback, daemon=True).start()

    def _do_playback(self):
        from pynput.keyboard import Controller as KbCtrl, Key
        from pynput.mouse import Controller as MsCtrl, Button

        self.after(0, lambda: self._status_var.set('▶ Playing back…'))
        self.after(0, lambda: self._play_btn.configure(fg=GREEN))

        kb = KbCtrl()
        ms = MsCtrl()
        prev_t = 0

        btn_map = {'left': Button.left, 'right': Button.right, 'middle': Button.middle}

        for ev in self._events:
            delay = (ev['time'] - prev_t) / 1000.0
            if delay > 0:
                time.sleep(delay)
            prev_t = ev['time']

            t = ev['type']
            if t == 'key':
                combo = ev['combo']
                parts = combo.split('+')
                base  = parts[-1]
                mods  = parts[:-1]
                mod_keys = []
                for m in mods:
                    mk = {'Ctrl': Key.ctrl, 'Alt': Key.alt,
                          'Shift': Key.shift, 'Meta': Key.cmd}.get(m)
                    if mk:
                        kb.press(mk); mod_keys.append(mk)
                try:
                    kb.press(base.lower() if len(base) == 1 else getattr(Key, base.lower(), base))
                    kb.release(base.lower() if len(base) == 1 else getattr(Key, base.lower(), base))
                except Exception:
                    pass
                for mk in reversed(mod_keys):
                    kb.release(mk)

            elif t == 'mouse_click':
                ms.position = (ev['x'], ev['y'])
                b = btn_map.get(ev.get('button', 'left'), Button.left)
                ms.click(b)

            elif t == 'mouse_move':
                ms.position = (ev['x'], ev['y'])

            elif t == 'mouse_scroll':
                ms.scroll(ev.get('dx', 0), ev.get('dy', 0))

        self.after(0, lambda: self._status_var.set('Playback complete'))
        self.after(0, lambda: self._play_btn.configure(fg=TEXT))

    # ── Export ────────────────────────────────────────────────────────────────

    def _export(self):
        if not self._events:
            messagebox.showinfo('Nothing to export', 'Record something first.')
            return
        path = filedialog.asksaveasfilename(
            defaultextension='.json',
            filetypes=[('JSON', '*.json'), ('All files', '*.*')],
            initialfile='macro.json',
            title='Export macro')
        if not path:
            return
        duration = self._events[-1]['time'] if self._events else 0
        payload = {
            'version': '1.0',
            'duration_ms': duration,
            'event_count': len(self._events),
            'events': self._events
        }
        with open(path, 'w') as f:
            json.dump(payload, f, indent=2)
        self._status_var.set(f'Exported → {path}')
        messagebox.showinfo('Exported', f'Saved {len(self._events)} events to:\n{path}')

    # ── Clear ─────────────────────────────────────────────────────────────────

    def _clear(self):
        if self._recording:
            self._stop_record()
        self._events = []
        self._log.configure(state='normal')
        self._log.delete('1.0', 'end')
        self._log.configure(state='disabled')
        self._status_var.set('Cleared — click ● REC to start')
        self._status_dot.configure(fg=MUTED)
        self._count_var.set('0 events')

    # ── Cleanup ───────────────────────────────────────────────────────────────

    def _on_close(self):
        if self._recording:
            self._stop_record()
        self.destroy()


if __name__ == '__main__':
    app = MacroRecorder()
    app.mainloop()
