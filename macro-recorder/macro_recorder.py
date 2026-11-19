"""
Stitch Keys — Macro Recorder
Records keyboard and mouse events globally, exports to JSON.
Requires: pip install pynput
"""

import tkinter as tk
from tkinter import font as tkfont, ttk, filedialog, messagebox
import json
import time
import threading

try:
    from pynput import keyboard, mouse as pmouse
    PYNPUT_OK = True
except ImportError:
    PYNPUT_OK = False

# ── Colour palette ────────────────────────────────────────────────────────────
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

TYPE_COLORS = {
    'key':         '#b8cfe8',
    'mouse_click': AMBER,
    'mouse_move':  '#5a8870',
    'mouse_scroll':'#9070c0',
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def fmt_key(key):
    try:
        return key.char.upper() if key.char else str(key)
    except AttributeError:
        name = str(key).replace('Key.', '')
        mapping = {
            'ctrl_l':'Ctrl','ctrl_r':'Ctrl','alt_l':'Alt','alt_r':'Alt',
            'shift':'Shift','shift_r':'Shift','cmd':'Meta','cmd_r':'Meta',
            'space':'Space','enter':'Enter','backspace':'Backspace',
            'delete':'Delete','tab':'Tab','esc':'Esc',
            'up':'↑','down':'↓','left':'←','right':'→',
            'f1':'F1','f2':'F2','f3':'F3','f4':'F4','f5':'F5','f6':'F6',
            'f7':'F7','f8':'F8','f9':'F9','f10':'F10','f11':'F11','f12':'F12',
        }
        return mapping.get(name, name.capitalize())

def build_combo(key, pressed_mods):
    base = fmt_key(key)
    if base in ('Ctrl', 'Alt', 'Shift', 'Meta'):
        return None
    parts = []
    if 'Ctrl'  in pressed_mods: parts.append('Ctrl')
    if 'Meta'  in pressed_mods: parts.append('Meta')
    if 'Alt'   in pressed_mods: parts.append('Alt')
    if 'Shift' in pressed_mods: parts.append('Shift')
    parts.append(base)
    return '+'.join(parts)

def fmt_button(btn):
    return str(btn).replace('Button.', '').capitalize()

def ev_detail(ev):
    t = ev['type']
    if t == 'key':
        return ev.get('combo', '')
    if t == 'mouse_click':
        return f"{ev.get('button','left').capitalize()}  ({ev['x']}, {ev['y']})"
    if t == 'mouse_move':
        return f"({ev['x']}, {ev['y']})"
    if t == 'mouse_scroll':
        d = '↑' if ev.get('dy', 0) > 0 else '↓'
        return f"Scroll {d}  ({ev['x']}, {ev['y']})"
    return ''

def ev_type_label(ev):
    return {'key':'KEY','mouse_click':'CLICK','mouse_move':'MOVE','mouse_scroll':'SCROLL'}.get(ev['type'], ev['type'])

# ── Main app ──────────────────────────────────────────────────────────────────

class MacroRecorder(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('Stitch Keys — Macro Recorder')
        self.configure(bg=BG)
        self.resizable(True, True)
        self.minsize(620, 500)

        self._recording       = False
        self._events          = []
        self._start_time      = 0.0
        self._pressed_mods    = set()
        self._kb_listener     = None
        self._ms_listener     = None
        self._last_mouse_move = 0.0
        self._edit_entry      = None   # active inline entry widget

        self._build_ui()
        self.protocol('WM_DELETE_WINDOW', self._on_close)

    # ── UI ────────────────────────────────────────────────────────────────────

    def _build_ui(self):
        hdr_font   = tkfont.Font(family='Segoe UI', size=15, weight='bold')
        label_font = tkfont.Font(family='Segoe UI', size=9)
        btn_font   = tkfont.Font(family='Segoe UI', size=9, weight='bold')
        self._table_font = tkfont.Font(family='Consolas', size=9)

        # Header
        hdr = tk.Frame(self, bg=SURFACE, pady=10)
        hdr.pack(fill='x')
        tk.Label(hdr, text='STITCH KEYS', font=hdr_font,
                 bg=SURFACE, fg=ACCENT).pack(side='left', padx=16)
        tk.Label(hdr, text='Macro Recorder', font=label_font,
                 bg=SURFACE, fg=MUTED).pack(side='left')

        # Main toolbar
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

        tk.Button(toolbar, text='Clear', font=btn_font, width=6,
                  bg=BORDER, fg=MUTED, activebackground='#2a4050',
                  relief='flat', bd=0, cursor='hand2',
                  command=self._clear).pack(side='left', padx=(0, 6))

        tk.Button(toolbar, text='Export JSON', font=btn_font,
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

        # Event table area
        table_outer = tk.Frame(self, bg=BG, padx=12, pady=8)
        table_outer.pack(fill='both', expand=True)

        # Section header + edit buttons on same row
        hdr_row = tk.Frame(table_outer, bg=BG)
        hdr_row.pack(fill='x', pady=(0, 4))
        tk.Label(hdr_row, text='CAPTURED EVENTS', font=label_font,
                 bg=BG, fg=MUTED).pack(side='left')

        edit_bar = tk.Frame(hdr_row, bg=BG)
        edit_bar.pack(side='right')
        small = tkfont.Font(family='Segoe UI', size=8, weight='bold')
        self._btn_up  = tk.Button(edit_bar, text='▲ Up',   font=small, width=5,
                                   bg=BORDER, fg=TEXT, relief='flat', bd=0,
                                   cursor='hand2', command=self._move_up)
        self._btn_dn  = tk.Button(edit_bar, text='▼ Down', font=small, width=5,
                                   bg=BORDER, fg=TEXT, relief='flat', bd=0,
                                   cursor='hand2', command=self._move_down)
        self._btn_del = tk.Button(edit_bar, text='✕ Del',  font=small, width=5,
                                   bg=BORDER, fg='#e07070', relief='flat', bd=0,
                                   cursor='hand2', command=self._delete_selected)
        self._btn_up.pack(side='left', padx=(0, 3))
        self._btn_dn.pack(side='left', padx=(0, 3))
        self._btn_del.pack(side='left')

        # Treeview table
        style = ttk.Style(self)
        style.theme_use('clam')
        style.configure('Macro.Treeview',
                        background='#0a1820', foreground=TEXT,
                        fieldbackground='#0a1820', rowheight=22,
                        font=self._table_font, borderwidth=0)
        style.configure('Macro.Treeview.Heading',
                        background=SURFACE, foreground=MUTED,
                        font=tkfont.Font(family='Segoe UI', size=8, weight='bold'),
                        relief='flat', borderwidth=0)
        style.map('Macro.Treeview',
                  background=[('selected', ACCENT)],
                  foreground=[('selected', '#ffffff')])

        frame = tk.Frame(table_outer, bg=BORDER)
        frame.pack(fill='both', expand=True)

        self._tree = ttk.Treeview(
            frame, style='Macro.Treeview',
            columns=('delay', 'type', 'detail'),
            show='headings', selectmode='browse')

        self._tree.heading('delay',  text='Delay (ms)',  anchor='e')
        self._tree.heading('type',   text='Type',        anchor='w')
        self._tree.heading('detail', text='Detail',      anchor='w')
        self._tree.column('delay',  width=90,  anchor='e', stretch=False)
        self._tree.column('type',   width=70,  anchor='w', stretch=False)
        self._tree.column('detail', width=300, anchor='w', stretch=True)

        vsb = ttk.Scrollbar(frame, orient='vertical',   command=self._tree.yview)
        hsb = ttk.Scrollbar(frame, orient='horizontal', command=self._tree.xview)
        self._tree.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)

        self._tree.grid(row=0, column=0, sticky='nsew')
        vsb.grid(row=0, column=1, sticky='ns')
        hsb.grid(row=1, column=0, sticky='ew')
        frame.rowconfigure(0, weight=1)
        frame.columnconfigure(0, weight=1)

        # Row tag colours
        for tag, color in TYPE_COLORS.items():
            self._tree.tag_configure(tag, foreground=color)
        self._tree.tag_configure('info', foreground=MUTED)

        # Hint label below table
        hint = tk.Frame(table_outer, bg=BG)
        hint.pack(fill='x', pady=(4, 0))
        tk.Label(hint, text='Double-click Delay (ms) to edit   •   Select row then use ▲▼ or ✕',
                 font=tkfont.Font(family='Segoe UI', size=8),
                 bg=BG, fg=MUTED).pack(side='left')

        self._tree.bind('<Double-1>', self._on_double_click)
        self._tree.bind('<Delete>',   lambda e: self._delete_selected())

        if not PYNPUT_OK:
            self._tree_append_info('  pynput not installed — run:  pip install pynput')

    # ── Table helpers ─────────────────────────────────────────────────────────

    def _tree_append_info(self, text):
        self._tree.insert('', 'end', values=('', '', text), tags=('info',))

    def _tree_append_event(self, ev, idx):
        delay = self._delay_for(idx)
        tag   = ev['type']
        self._tree.insert('', 'end', iid=str(idx),
                          values=(delay, ev_type_label(ev), ev_detail(ev)),
                          tags=(tag,))
        self._tree.see(str(idx))
        self._count_var.set(f'{len(self._events)} events')

    def _refresh_table(self):
        """Redraw entire table from self._events."""
        for item in self._tree.get_children():
            self._tree.delete(item)
        for i, ev in enumerate(self._events):
            delay = self._delay_for(i)
            tag   = ev['type']
            self._tree.insert('', 'end', iid=str(i),
                              values=(delay, ev_type_label(ev), ev_detail(ev)),
                              tags=(tag,))
        self._count_var.set(f'{len(self._events)} events')

    def _delay_for(self, idx):
        """Return delay in ms since previous event (or since start)."""
        if idx == 0:
            return self._events[0]['time']
        return self._events[idx]['time'] - self._events[idx - 1]['time']

    def _selected_index(self):
        sel = self._tree.selection()
        if not sel:
            return None
        try:
            return int(sel[0])
        except (ValueError, TypeError):
            return None

    # ── Inline delay editor ───────────────────────────────────────────────────

    def _on_double_click(self, event):
        region = self._tree.identify_region(event.x, event.y)
        col    = self._tree.identify_column(event.x)
        iid    = self._tree.identify_row(event.y)
        if region != 'cell' or col != '#1' or not iid:
            return
        try:
            idx = int(iid)
        except ValueError:
            return
        self._open_delay_editor(iid, idx)

    def _open_delay_editor(self, iid, idx):
        if self._edit_entry:
            self._edit_entry.destroy()
            self._edit_entry = None

        bbox = self._tree.bbox(iid, column='#1')
        if not bbox:
            return
        x, y, w, h = bbox

        current = str(self._delay_for(idx))
        var = tk.StringVar(value=current)

        entry = tk.Entry(self._tree, textvariable=var,
                         bg='#1a3545', fg=TEXT, insertbackground=TEXT,
                         selectbackground=ACCENT,
                         relief='flat', bd=4,
                         font=self._table_font, justify='right')
        entry.place(x=x, y=y, width=w, height=h)
        entry.select_range(0, 'end')
        entry.focus_set()
        self._edit_entry = entry

        def commit(e=None):
            try:
                new_delay = max(0, int(var.get()))
            except ValueError:
                cancel()
                return
            self._apply_delay(idx, new_delay)
            cancel()

        def cancel(e=None):
            if self._edit_entry:
                self._edit_entry.destroy()
                self._edit_entry = None

        entry.bind('<Return>',  commit)
        entry.bind('<Tab>',     commit)
        entry.bind('<Escape>',  cancel)
        entry.bind('<FocusOut>', cancel)

    def _apply_delay(self, idx, new_delay_ms):
        """Set delay for event idx and shift all subsequent absolute times."""
        old_abs = self._events[idx]['time']
        base    = self._events[idx - 1]['time'] if idx > 0 else 0
        new_abs = base + new_delay_ms
        delta   = new_abs - old_abs
        for i in range(idx, len(self._events)):
            self._events[i]['time'] += delta
        self._refresh_table()
        # Re-select the edited row
        if str(idx) in self._tree.get_children():
            self._tree.selection_set(str(idx))

    # ── Row reorder / delete ──────────────────────────────────────────────────

    def _move_up(self):
        idx = self._selected_index()
        if idx is None or idx == 0:
            return
        self._swap_events(idx, idx - 1)
        self._tree.selection_set(str(idx - 1))

    def _move_down(self):
        idx = self._selected_index()
        if idx is None or idx >= len(self._events) - 1:
            return
        self._swap_events(idx, idx + 1)
        self._tree.selection_set(str(idx + 1))

    def _swap_events(self, a, b):
        """Swap events a and b, keeping absolute times in place (only content swaps)."""
        t_a = self._events[a]['time']
        t_b = self._events[b]['time']
        self._events[a], self._events[b] = self._events[b], self._events[a]
        self._events[a]['time'] = t_a
        self._events[b]['time'] = t_b
        self._refresh_table()

    def _delete_selected(self):
        idx = self._selected_index()
        if idx is None:
            return
        # Remove event and re-anchor the next event's time so delays don't jump
        if idx + 1 < len(self._events):
            before = self._events[idx - 1]['time'] if idx > 0 else 0
            gap    = self._events[idx + 1]['time'] - self._events[idx]['time']
            self._events[idx + 1]['time'] = before + gap
        del self._events[idx]
        self._refresh_table()
        # Select the same position (or last row)
        new_idx = min(idx, len(self._events) - 1)
        if new_idx >= 0 and str(new_idx) in self._tree.get_children():
            self._tree.selection_set(str(new_idx))

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
        self._recording = True
        self._start_time = time.time()
        self._pressed_mods.clear()
        self._events = []

        for item in self._tree.get_children():
            self._tree.delete(item)

        self._rec_btn.configure(text='■  STOP', bg='#8a2020', fg=RED)
        self._status_var.set('Recording — press shortcuts and click anywhere…')
        self._status_dot.configure(fg=RED)
        self._count_var.set('0 events')
        self._tree_append_info('── Recording started ──')

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
        # Rebuild table cleanly (removes the "Recording started" info row)
        self._refresh_table()

    # ── pynput callbacks ──────────────────────────────────────────────────────

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
        self.after(0, self._tree_append_event, ev, len(self._events) - 1)

    def _on_key_release(self, key):
        self._pressed_mods.discard(fmt_key(key))

    def _on_click(self, x, y, button, pressed):
        if not self._recording or not pressed:
            return
        t = self._elapsed()
        btn = fmt_button(button)
        ev = {'time': round(t * 1000), 'type': 'mouse_click',
              'x': x, 'y': y, 'button': btn.lower()}
        self._events.append(ev)
        self.after(0, self._tree_append_event, ev, len(self._events) - 1)

    def _on_scroll(self, x, y, dx, dy):
        if not self._recording:
            return
        t = self._elapsed()
        ev = {'time': round(t * 1000), 'type': 'mouse_scroll',
              'x': x, 'y': y, 'dx': dx, 'dy': dy}
        self._events.append(ev)
        self.after(0, self._tree_append_event, ev, len(self._events) - 1)

    def _on_move(self, x, y):
        if not self._recording:
            return
        now = time.time()
        if now - self._last_mouse_move < 0.25:
            return
        self._last_mouse_move = now
        t = self._elapsed()
        ev = {'time': round(t * 1000), 'type': 'mouse_move', 'x': x, 'y': y}
        self._events.append(ev)
        self.after(0, self._tree_append_event, ev, len(self._events) - 1)

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
        btn_map = {'left': Button.left, 'right': Button.right, 'middle': Button.middle}
        prev_t = 0

        for ev in self._events:
            delay = (ev['time'] - prev_t) / 1000.0
            if delay > 0:
                time.sleep(delay)
            prev_t = ev['time']

            t = ev['type']
            if t == 'key':
                combo    = ev['combo']
                parts    = combo.split('+')
                base     = parts[-1]
                mod_keys = []
                for m in parts[:-1]:
                    mk = {'Ctrl': Key.ctrl, 'Alt': Key.alt,
                          'Shift': Key.shift, 'Meta': Key.cmd}.get(m)
                    if mk:
                        kb.press(mk); mod_keys.append(mk)
                try:
                    k = base.lower() if len(base) == 1 else getattr(Key, base.lower(), base)
                    kb.press(k); kb.release(k)
                except Exception:
                    pass
                for mk in reversed(mod_keys):
                    kb.release(mk)

            elif t == 'mouse_click':
                ms.position = (ev['x'], ev['y'])
                ms.click(btn_map.get(ev.get('button', 'left'), Button.left))

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
            initialfile='macro.json', title='Export macro')
        if not path:
            return
        payload = {
            'version': '1.0',
            'duration_ms': self._events[-1]['time'] if self._events else 0,
            'event_count': len(self._events),
            'events': self._events,
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
        for item in self._tree.get_children():
            self._tree.delete(item)
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
