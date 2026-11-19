"""
Stitch Keys — Macro Recorder
Requires:          pip install pynput
System tray (opt): pip install pystray Pillow
"""

import tkinter as tk
from tkinter import font as tkfont, ttk, filedialog, messagebox
import json, time, threading, copy

try:
    from pynput import keyboard, mouse as pmouse
    PYNPUT_OK = True
except ImportError:
    PYNPUT_OK = False

try:
    import pystray
    from PIL import Image, ImageDraw
    TRAY_OK = True
except ImportError:
    TRAY_OK = False

# ── Palette ───────────────────────────────────────────────────────────────────
BG      = '#0f1e24'
SURFACE = '#162830'
BORDER  = '#1f3540'
TEXT    = '#d4d8e0'
MUTED   = '#6a7a88'
ACCENT  = '#7390b9'
RED     = '#e05050'
RED_DIM = '#7a2828'
GREEN   = '#44cc88'
AMBER   = '#c9882a'

TYPE_COLORS = {
    'key':         '#b8cfe8',
    'mouse_click': AMBER,
    'mouse_move':  '#5a8870',
    'mouse_scroll':'#9070c0',
    'wait':        MUTED,
}

SPEED_OPTIONS = ['0.25×','0.5×','0.75×','1×','1.5×','2×','3×','4×']
SPEED_VALUES  = { s: float(s.rstrip('×')) for s in SPEED_OPTIONS }

# ── Helpers ───────────────────────────────────────────────────────────────────

def fmt_key(key):
    try:
        return key.char.upper() if key.char else str(key)
    except AttributeError:
        name = str(key).replace('Key.','')
        m = {'ctrl_l':'Ctrl','ctrl_r':'Ctrl','alt_l':'Alt','alt_r':'Alt',
             'shift':'Shift','shift_r':'Shift','cmd':'Meta','cmd_r':'Meta',
             'space':'Space','enter':'Enter','backspace':'Backspace',
             'delete':'Delete','tab':'Tab','esc':'Esc',
             'up':'↑','down':'↓','left':'←','right':'→',
             **{f'f{i}':f'F{i}' for i in range(1,13)}}
        return m.get(name, name.capitalize())

def build_combo(key, mods):
    base = fmt_key(key)
    if base in ('Ctrl','Alt','Shift','Meta'): return None
    parts = [m for m in ('Ctrl','Meta','Alt','Shift') if m in mods] + [base]
    return '+'.join(parts)

def fmt_button(btn):
    return str(btn).replace('Button.','').capitalize()

def ev_detail(ev):
    t = ev['type']
    if t == 'key':         return ev.get('combo','')
    if t == 'mouse_click': return f"{ev.get('button','left').capitalize()}  ({ev['x']}, {ev['y']})"
    if t == 'mouse_move':  return f"({ev['x']}, {ev['y']})"
    if t == 'mouse_scroll':
        return f"Scroll {'↑' if ev.get('dy',0)>0 else '↓'}  ({ev['x']}, {ev['y']})"
    if t == 'wait':        return f"Wait {ev.get('ms',0)} ms"
    return ''

def ev_label(ev):
    return {'key':'KEY','mouse_click':'CLICK','mouse_move':'MOVE',
            'mouse_scroll':'SCROLL','wait':'WAIT'}.get(ev['type'], ev['type'])

# ── App ───────────────────────────────────────────────────────────────────────

class MacroRecorder(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('Stitch Keys — Macro Recorder')
        self.configure(bg=BG)
        self.resizable(True, True)
        self.minsize(680, 540)

        # Recording state
        self._recording        = False
        self._events           = []
        self._start_time       = 0.0
        self._pressed_mods     = set()
        self._kb_listener      = None
        self._ms_listener      = None
        self._last_mouse_move  = 0.0
        self._record_origin    = None   # first mouse position during recording

        # Playback state
        self._playing          = False
        self._stop_evt         = threading.Event()

        # Edit state
        self._undo_history     = []
        self._edit_entry       = None

        # Hotkey
        self._hotkey_listener  = None

        # Tray
        self._tray_icon        = None

        # UI vars
        self._repeat_var       = tk.IntVar(value=1)
        self._speed_var        = tk.StringVar(value='1×')
        self._countdown_var    = tk.BooleanVar(value=False)
        self._hotkey_var       = tk.BooleanVar(value=False)
        self._rel_mouse_var    = tk.BooleanVar(value=False)
        self._ontop_var        = tk.BooleanVar(value=False)
        self._status_var       = tk.StringVar(value='Ready — click ● REC to start')
        self._count_var        = tk.StringVar(value='0 events')
        self._duration_var     = tk.StringVar(value='Total: 0.0s')

        self._build_ui()
        self.protocol('WM_DELETE_WINDOW', self._on_close)

        if not PYNPUT_OK:
            self._status_var.set('pynput not installed — pip install pynput')

    # ── UI ────────────────────────────────────────────────────────────────────

    def _build_ui(self):
        hdr_font   = tkfont.Font(family='Segoe UI', size=15, weight='bold')
        lbl_font   = tkfont.Font(family='Segoe UI', size=9)
        btn_font   = tkfont.Font(family='Segoe UI', size=9, weight='bold')
        small_font = tkfont.Font(family='Segoe UI', size=8, weight='bold')
        self._tf   = tkfont.Font(family='Consolas', size=9)

        # Header
        hdr = tk.Frame(self, bg=SURFACE, pady=10)
        hdr.pack(fill='x')
        tk.Label(hdr, text='STITCH KEYS', font=hdr_font, bg=SURFACE, fg=ACCENT).pack(side='left', padx=16)
        tk.Label(hdr, text='Macro Recorder', font=lbl_font, bg=SURFACE, fg=MUTED).pack(side='left')

        # ── Main toolbar ──────────────────────────────────────────────────────
        tb = tk.Frame(self, bg=BG, pady=8, padx=12)
        tb.pack(fill='x')

        self._rec_btn = tk.Button(tb, text='● REC', font=btn_font, width=8,
            bg=RED_DIM, fg='#f07070', activebackground='#8a2020',
            relief='flat', bd=0, cursor='hand2', command=self._toggle_record)
        self._rec_btn.pack(side='left', padx=(0,6))

        self._play_btn = tk.Button(tb, text='▶  PLAY', font=btn_font, width=8,
            bg=BORDER, fg=TEXT, activebackground='#2a4050',
            relief='flat', bd=0, cursor='hand2', command=self._toggle_play)
        self._play_btn.pack(side='left', padx=(0,6))

        tk.Button(tb, text='Clear', font=btn_font, width=6,
            bg=BORDER, fg=MUTED, activebackground='#2a4050',
            relief='flat', bd=0, cursor='hand2', command=self._clear).pack(side='left', padx=(0,6))

        tk.Button(tb, text='Load JSON', font=btn_font,
            bg=BORDER, fg=TEXT, activebackground='#2a4050',
            relief='flat', bd=0, cursor='hand2', command=self._load).pack(side='left', padx=(0,6))

        tk.Button(tb, text='Export JSON', font=btn_font,
            bg=BORDER, fg=ACCENT, activebackground='#2a4050',
            relief='flat', bd=0, cursor='hand2', command=self._export).pack(side='right')

        self._ontop_btn = tk.Button(tb, text='⊤ Top', font=small_font, width=6,
            bg=BORDER, fg=MUTED, activebackground='#2a4050',
            relief='flat', bd=0, cursor='hand2', command=self._toggle_ontop)
        self._ontop_btn.pack(side='right', padx=(0,6))

        if TRAY_OK:
            tk.Button(tb, text='⊟ Tray', font=small_font, width=6,
                bg=BORDER, fg=MUTED, activebackground='#2a4050',
                relief='flat', bd=0, cursor='hand2', command=self._send_to_tray).pack(side='right', padx=(0,4))

        # ── Playback options ──────────────────────────────────────────────────
        opts = tk.Frame(self, bg=SURFACE, pady=5, padx=12)
        opts.pack(fill='x')

        tk.Label(opts, text='Repeat:', font=lbl_font, bg=SURFACE, fg=MUTED).pack(side='left')
        tk.Spinbox(opts, textvariable=self._repeat_var, from_=1, to=999, width=4,
            bg=BORDER, fg=TEXT, buttonbackground=BORDER, relief='flat',
            font=lbl_font, insertbackground=TEXT).pack(side='left', padx=(3,12))

        tk.Label(opts, text='Speed:', font=lbl_font, bg=SURFACE, fg=MUTED).pack(side='left')
        spd = ttk.Combobox(opts, textvariable=self._speed_var, values=SPEED_OPTIONS,
                           width=5, state='readonly', font=lbl_font)
        spd.pack(side='left', padx=(3,12))

        tk.Checkbutton(opts, text='Countdown 3s', font=lbl_font,
            variable=self._countdown_var, bg=SURFACE, fg=TEXT,
            selectcolor=BORDER, activebackground=SURFACE).pack(side='left', padx=(0,12))

        self._hotkey_chk = tk.Checkbutton(opts, text='Hotkey F9', font=lbl_font,
            variable=self._hotkey_var, bg=SURFACE, fg=TEXT,
            selectcolor=BORDER, activebackground=SURFACE,
            command=self._toggle_hotkey)
        self._hotkey_chk.pack(side='left', padx=(0,12))

        tk.Checkbutton(opts, text='Relative mouse', font=lbl_font,
            variable=self._rel_mouse_var, bg=SURFACE, fg=TEXT,
            selectcolor=BORDER, activebackground=SURFACE).pack(side='left')

        # ── Status bar ────────────────────────────────────────────────────────
        status = tk.Frame(self, bg=BG, pady=4, padx=12)
        status.pack(fill='x')
        self._status_dot = tk.Label(status, text='●', font=lbl_font, bg=BG, fg=MUTED, width=2)
        self._status_dot.pack(side='left')
        tk.Label(status, textvariable=self._status_var, font=lbl_font, bg=BG, fg=TEXT, anchor='w').pack(side='left')
        tk.Label(status, textvariable=self._duration_var, font=lbl_font, bg=BG, fg=MUTED).pack(side='right')
        tk.Label(status, textvariable=self._count_var, font=lbl_font, bg=BG, fg=MUTED).pack(side='right', padx=(0,16))

        # ── Event table ───────────────────────────────────────────────────────
        tbl_area = tk.Frame(self, bg=BG, padx=12, pady=6)
        tbl_area.pack(fill='both', expand=True)

        hdr_row = tk.Frame(tbl_area, bg=BG)
        hdr_row.pack(fill='x', pady=(0,4))
        tk.Label(hdr_row, text='CAPTURED EVENTS', font=lbl_font, bg=BG, fg=MUTED).pack(side='left')

        eb = tk.Frame(hdr_row, bg=BG)
        eb.pack(side='right')
        def eb_btn(text, cmd, fg=TEXT, w=6):
            return tk.Button(eb, text=text, font=small_font, width=w,
                bg=BORDER, fg=fg, relief='flat', bd=0, cursor='hand2', command=cmd)

        self._btn_undo = eb_btn('↩ Undo', self._undo, fg=ACCENT)
        self._btn_ins  = eb_btn('+Insert', self._insert_event)
        self._btn_dup  = eb_btn('⎘ Dup',  self._duplicate_row)
        self._btn_del  = eb_btn('✕ Del',  self._delete_selected, fg='#e07070')
        self._btn_dn   = eb_btn('▼ Down', self._move_down)
        self._btn_up   = eb_btn('▲ Up',   self._move_up)
        for b in (self._btn_up, self._btn_dn, self._btn_del, self._btn_dup,
                  self._btn_ins, self._btn_undo):
            b.pack(side='left', padx=(0,3))

        # Treeview
        style = ttk.Style(self)
        style.theme_use('clam')
        style.configure('M.Treeview', background='#0a1820', foreground=TEXT,
                        fieldbackground='#0a1820', rowheight=22,
                        font=self._tf, borderwidth=0)
        style.configure('M.Treeview.Heading', background=SURFACE, foreground=MUTED,
                        font=tkfont.Font(family='Segoe UI', size=8, weight='bold'),
                        relief='flat', borderwidth=0)
        style.map('M.Treeview', background=[('selected', ACCENT)],
                                foreground=[('selected','#ffffff')])

        frm = tk.Frame(tbl_area, bg=BORDER)
        frm.pack(fill='both', expand=True)
        self._tree = ttk.Treeview(frm, style='M.Treeview',
                                   columns=('delay','type','detail'),
                                   show='headings', selectmode='browse')
        self._tree.heading('delay',  text='Delay (ms)', anchor='e')
        self._tree.heading('type',   text='Type',       anchor='w')
        self._tree.heading('detail', text='Detail',     anchor='w')
        self._tree.column('delay',  width=90,  anchor='e', stretch=False)
        self._tree.column('type',   width=70,  anchor='w', stretch=False)
        self._tree.column('detail', width=360, anchor='w', stretch=True)
        for tag, color in TYPE_COLORS.items():
            self._tree.tag_configure(tag, foreground=color)
        self._tree.tag_configure('info', foreground=MUTED)

        vsb = ttk.Scrollbar(frm, orient='vertical',   command=self._tree.yview)
        hsb = ttk.Scrollbar(frm, orient='horizontal', command=self._tree.xview)
        self._tree.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)
        self._tree.grid(row=0, column=0, sticky='nsew')
        vsb.grid(row=0, column=1, sticky='ns')
        hsb.grid(row=1, column=0, sticky='ew')
        frm.rowconfigure(0, weight=1); frm.columnconfigure(0, weight=1)

        # Hint
        tk.Label(tbl_area,
                 text='Double-click Delay (ms) to edit   •   Select row then use ▲▼ ✕ ⎘   •   Ctrl+Z = undo',
                 font=tkfont.Font(family='Segoe UI', size=8),
                 bg=BG, fg=MUTED).pack(anchor='w', pady=(4,0))

        self._tree.bind('<Double-1>', self._on_double_click)
        self._tree.bind('<Delete>',   lambda e: self._delete_selected())
        self.bind('<Control-z>',      lambda e: self._undo())

    # ── Table helpers ─────────────────────────────────────────────────────────

    def _delay_for(self, idx):
        if idx == 0: return self._events[0]['time']
        return self._events[idx]['time'] - self._events[idx-1]['time']

    def _refresh_table(self):
        for item in self._tree.get_children():
            self._tree.delete(item)
        for i, ev in enumerate(self._events):
            self._tree.insert('', 'end', iid=str(i),
                              values=(self._delay_for(i), ev_label(ev), ev_detail(ev)),
                              tags=(ev['type'],))
        self._count_var.set(f'{len(self._events)} events')
        self._update_duration()

    def _tree_insert_live(self, ev, idx):
        self._tree.insert('', 'end', iid=str(idx),
                          values=(self._delay_for(idx), ev_label(ev), ev_detail(ev)),
                          tags=(ev['type'],))
        self._tree.see(str(idx))
        self._count_var.set(f'{len(self._events)} events')
        self._update_duration()

    def _update_duration(self):
        if self._events:
            self._duration_var.set(f'Total: {self._events[-1]["time"]/1000:.1f}s')
        else:
            self._duration_var.set('Total: 0.0s')

    def _selected_index(self):
        sel = self._tree.selection()
        if not sel: return None
        try: return int(sel[0])
        except (ValueError, TypeError): return None

    # ── Undo ──────────────────────────────────────────────────────────────────

    def _push_undo(self):
        self._undo_history.append(copy.deepcopy(self._events))
        if len(self._undo_history) > 50:
            self._undo_history.pop(0)

    def _undo(self):
        if not self._undo_history:
            self._status_var.set('Nothing to undo')
            return
        self._events = self._undo_history.pop()
        self._refresh_table()
        self._status_var.set('Undone')

    # ── Inline delay editor ───────────────────────────────────────────────────

    def _on_double_click(self, event):
        region = self._tree.identify_region(event.x, event.y)
        col    = self._tree.identify_column(event.x)
        iid    = self._tree.identify_row(event.y)
        if region != 'cell' or col != '#1' or not iid: return
        try: idx = int(iid)
        except ValueError: return
        self._open_delay_editor(iid, idx)

    def _open_delay_editor(self, iid, idx):
        if self._edit_entry:
            self._edit_entry.destroy(); self._edit_entry = None
        bbox = self._tree.bbox(iid, column='#1')
        if not bbox: return
        x, y, w, h = bbox
        var = tk.StringVar(value=str(self._delay_for(idx)))
        entry = tk.Entry(self._tree, textvariable=var, bg='#1a3545', fg=TEXT,
                         insertbackground=TEXT, selectbackground=ACCENT,
                         relief='flat', bd=4, font=self._tf, justify='right')
        entry.place(x=x, y=y, width=w, height=h)
        entry.select_range(0, 'end')
        entry.focus_set()
        self._edit_entry = entry

        def commit(e=None):
            try: new_delay = max(0, int(var.get()))
            except ValueError: cancel(); return
            self._push_undo()
            self._apply_delay(idx, new_delay)
            cancel()

        def cancel(e=None):
            if self._edit_entry:
                self._edit_entry.destroy(); self._edit_entry = None

        entry.bind('<Return>',   commit)
        entry.bind('<Tab>',      commit)
        entry.bind('<Escape>',   cancel)
        entry.bind('<FocusOut>', cancel)

    def _apply_delay(self, idx, new_delay_ms):
        base    = self._events[idx-1]['time'] if idx > 0 else 0
        delta   = (base + new_delay_ms) - self._events[idx]['time']
        for i in range(idx, len(self._events)):
            self._events[i]['time'] += delta
        self._refresh_table()
        if str(idx) in self._tree.get_children():
            self._tree.selection_set(str(idx))

    # ── Row edit operations ───────────────────────────────────────────────────

    def _move_up(self):
        idx = self._selected_index()
        if idx is None or idx == 0: return
        self._push_undo()
        self._swap_events(idx, idx-1)
        self._tree.selection_set(str(idx-1))

    def _move_down(self):
        idx = self._selected_index()
        if idx is None or idx >= len(self._events)-1: return
        self._push_undo()
        self._swap_events(idx, idx+1)
        self._tree.selection_set(str(idx+1))

    def _swap_events(self, a, b):
        t_a = self._events[a]['time']; t_b = self._events[b]['time']
        self._events[a], self._events[b] = self._events[b], self._events[a]
        self._events[a]['time'] = t_a; self._events[b]['time'] = t_b
        self._refresh_table()

    def _delete_selected(self):
        idx = self._selected_index()
        if idx is None: return
        self._push_undo()
        if idx+1 < len(self._events):
            before = self._events[idx-1]['time'] if idx > 0 else 0
            gap    = self._events[idx+1]['time'] - self._events[idx]['time']
            self._events[idx+1]['time'] = before + gap
        del self._events[idx]
        self._refresh_table()
        new_idx = min(idx, len(self._events)-1)
        if new_idx >= 0 and str(new_idx) in self._tree.get_children():
            self._tree.selection_set(str(new_idx))

    def _duplicate_row(self):
        idx = self._selected_index()
        if idx is None: return
        self._push_undo()
        ev = copy.deepcopy(self._events[idx])
        insert_at = idx + 1
        # Place it 100ms after the original
        gap = 100
        ev['time'] = self._events[idx]['time'] + gap
        # Shift all subsequent events
        self._events.insert(insert_at, ev)
        for i in range(insert_at+1, len(self._events)):
            self._events[i]['time'] += gap
        self._refresh_table()
        self._tree.selection_set(str(insert_at))

    def _insert_event(self):
        """Open dialog to manually insert a KEY, CLICK, or WAIT event."""
        idx = self._selected_index()
        insert_at = (idx+1) if idx is not None else len(self._events)
        prev_time = self._events[idx]['time'] if idx is not None and self._events else 0

        dlg = tk.Toplevel(self)
        dlg.title('Insert Event')
        dlg.configure(bg=BG)
        dlg.resizable(False, False)
        dlg.grab_set()
        dlg.transient(self)

        lf = tkfont.Font(family='Segoe UI', size=9)
        bf = tkfont.Font(family='Segoe UI', size=9, weight='bold')

        tk.Label(dlg, text='Insert Event', font=bf, bg=BG, fg=ACCENT).grid(row=0, column=0, columnspan=2, padx=16, pady=(14,10), sticky='w')

        # Type
        tk.Label(dlg, text='Type:', font=lf, bg=BG, fg=MUTED).grid(row=1, column=0, padx=16, pady=4, sticky='w')
        type_var = tk.StringVar(value='KEY')
        type_menu = ttk.Combobox(dlg, textvariable=type_var, values=['KEY','CLICK','WAIT'],
                                 state='readonly', width=10, font=lf)
        type_menu.grid(row=1, column=1, padx=(0,16), pady=4, sticky='w')

        # Delay
        tk.Label(dlg, text='Delay before (ms):', font=lf, bg=BG, fg=MUTED).grid(row=2, column=0, padx=16, pady=4, sticky='w')
        delay_var = tk.IntVar(value=100)
        tk.Spinbox(dlg, textvariable=delay_var, from_=0, to=60000, width=8,
                   bg=BORDER, fg=TEXT, buttonbackground=BORDER, relief='flat',
                   font=lf, insertbackground=TEXT).grid(row=2, column=1, padx=(0,16), pady=4, sticky='w')

        # Dynamic detail frame
        detail_frame = tk.Frame(dlg, bg=BG)
        detail_frame.grid(row=3, column=0, columnspan=2, padx=16, pady=4, sticky='ew')

        combo_var  = tk.StringVar(value='Ctrl+C')
        mx_var     = tk.IntVar(value=0)
        my_var     = tk.IntVar(value=0)
        mbtn_var   = tk.StringVar(value='left')
        wait_ms    = tk.IntVar(value=500)

        def rebuild_detail(*_):
            for w in detail_frame.winfo_children(): w.destroy()
            t = type_var.get()
            if t == 'KEY':
                tk.Label(detail_frame, text='Combo:', font=lf, bg=BG, fg=MUTED).grid(row=0, column=0, sticky='w', pady=2)
                tk.Entry(detail_frame, textvariable=combo_var, bg=BORDER, fg=TEXT,
                         insertbackground=TEXT, relief='flat', font=lf, width=18).grid(row=0, column=1, padx=(6,0), sticky='w')
                tk.Label(detail_frame, text='e.g. Ctrl+C, F5, Alt+Tab', font=tkfont.Font(family='Segoe UI',size=8),
                         bg=BG, fg=MUTED).grid(row=1, column=1, padx=(6,0), sticky='w')
            elif t == 'CLICK':
                tk.Label(detail_frame, text='X:', font=lf, bg=BG, fg=MUTED).grid(row=0, column=0, sticky='w', pady=2)
                tk.Spinbox(detail_frame, textvariable=mx_var, from_=0, to=9999, width=6,
                           bg=BORDER, fg=TEXT, buttonbackground=BORDER, relief='flat', font=lf,
                           insertbackground=TEXT).grid(row=0, column=1, padx=(6,0), sticky='w')
                tk.Label(detail_frame, text='Y:', font=lf, bg=BG, fg=MUTED).grid(row=1, column=0, sticky='w', pady=2)
                tk.Spinbox(detail_frame, textvariable=my_var, from_=0, to=9999, width=6,
                           bg=BORDER, fg=TEXT, buttonbackground=BORDER, relief='flat', font=lf,
                           insertbackground=TEXT).grid(row=1, column=1, padx=(6,0), sticky='w')
                tk.Label(detail_frame, text='Button:', font=lf, bg=BG, fg=MUTED).grid(row=2, column=0, sticky='w', pady=2)
                ttk.Combobox(detail_frame, textvariable=mbtn_var, values=['left','right','middle'],
                             state='readonly', width=8, font=lf).grid(row=2, column=1, padx=(6,0), sticky='w')
            elif t == 'WAIT':
                tk.Label(detail_frame, text='Wait (ms):', font=lf, bg=BG, fg=MUTED).grid(row=0, column=0, sticky='w', pady=2)
                tk.Spinbox(detail_frame, textvariable=wait_ms, from_=0, to=60000, width=8,
                           bg=BORDER, fg=TEXT, buttonbackground=BORDER, relief='flat', font=lf,
                           insertbackground=TEXT).grid(row=0, column=1, padx=(6,0), sticky='w')

        type_var.trace_add('write', rebuild_detail)
        rebuild_detail()

        def confirm():
            t = type_var.get()
            d = delay_var.get()
            base_time = prev_time + d
            if t == 'KEY':
                ev = {'time': base_time, 'type': 'key', 'combo': combo_var.get().strip() or 'A'}
            elif t == 'CLICK':
                ev = {'time': base_time, 'type': 'mouse_click',
                      'x': mx_var.get(), 'y': my_var.get(), 'button': mbtn_var.get()}
            else:
                ev = {'time': base_time, 'type': 'wait', 'ms': wait_ms.get()}
            self._push_undo()
            self._events.insert(insert_at, ev)
            # Shift subsequent events
            for i in range(insert_at+1, len(self._events)):
                self._events[i]['time'] += d
            self._refresh_table()
            self._tree.selection_set(str(insert_at))
            dlg.destroy()

        btn_row = tk.Frame(dlg, bg=BG)
        btn_row.grid(row=4, column=0, columnspan=2, pady=(10,14))
        tk.Button(btn_row, text='Insert', font=bf, bg=ACCENT, fg='#ffffff',
                  relief='flat', bd=0, cursor='hand2', padx=10,
                  command=confirm).pack(side='left', padx=6)
        tk.Button(btn_row, text='Cancel', font=lf, bg=BORDER, fg=MUTED,
                  relief='flat', bd=0, cursor='hand2', padx=10,
                  command=dlg.destroy).pack(side='left')
        dlg.bind('<Return>', lambda e: confirm())
        dlg.bind('<Escape>', lambda e: dlg.destroy())

        # Center over parent
        self.update_idletasks()
        x = self.winfo_x() + (self.winfo_width()  - 360)//2
        y = self.winfo_y() + (self.winfo_height() - 300)//2
        dlg.geometry(f'360x300+{x}+{y}')

    # ── Recording ─────────────────────────────────────────────────────────────

    def _toggle_record(self):
        if self._recording: self._stop_record()
        else: self._start_record()

    def _start_record(self):
        if not PYNPUT_OK:
            messagebox.showerror('Missing dependency', 'pip install pynput'); return
        if self._playing: self._abort_play()
        self._recording = True
        self._start_time = time.time()
        self._pressed_mods.clear()
        self._events = []
        self._record_origin = None
        for item in self._tree.get_children(): self._tree.delete(item)
        self._rec_btn.configure(text='■  STOP', bg='#8a2020', fg=RED)
        self._status_var.set('Recording — press shortcuts and click anywhere…')
        self._status_dot.configure(fg=RED)
        self._count_var.set('0 events')
        self._duration_var.set('Total: 0.0s')
        self._kb_listener = keyboard.Listener(
            on_press=self._on_key_press, on_release=self._on_key_release)
        self._ms_listener = pmouse.Listener(
            on_click=self._on_click, on_scroll=self._on_scroll, on_move=self._on_move)
        self._kb_listener.start(); self._ms_listener.start()

    def _stop_record(self):
        self._recording = False
        if self._kb_listener: self._kb_listener.stop(); self._kb_listener = None
        if self._ms_listener: self._ms_listener.stop(); self._ms_listener = None
        self._rec_btn.configure(text='● REC', bg=RED_DIM, fg='#f07070')
        self._status_var.set(f'Stopped — {len(self._events)} events captured')
        self._status_dot.configure(fg=GREEN if self._events else MUTED)
        self._refresh_table()

    # ── pynput callbacks ──────────────────────────────────────────────────────

    def _elapsed(self):
        return time.time() - self._start_time

    def _on_key_press(self, key):
        if not self._recording: return
        name = fmt_key(key)
        if name in ('Ctrl','Alt','Shift','Meta'): self._pressed_mods.add(name); return
        combo = build_combo(key, self._pressed_mods)
        if not combo: return
        t = self._elapsed()
        ev = {'time': round(t*1000), 'type': 'key', 'combo': combo}
        self._events.append(ev)
        self.after(0, self._tree_insert_live, ev, len(self._events)-1)

    def _on_key_release(self, key):
        self._pressed_mods.discard(fmt_key(key))

    def _on_click(self, x, y, button, pressed):
        if not self._recording or not pressed: return
        if self._record_origin is None: self._record_origin = (x, y)
        t = self._elapsed(); btn = fmt_button(button)
        ev = {'time': round(t*1000), 'type': 'mouse_click',
              'x': x, 'y': y, 'button': btn.lower()}
        self._events.append(ev)
        self.after(0, self._tree_insert_live, ev, len(self._events)-1)

    def _on_scroll(self, x, y, dx, dy):
        if not self._recording: return
        if self._record_origin is None: self._record_origin = (x, y)
        t = self._elapsed()
        ev = {'time': round(t*1000), 'type': 'mouse_scroll',
              'x': x, 'y': y, 'dx': dx, 'dy': dy}
        self._events.append(ev)
        self.after(0, self._tree_insert_live, ev, len(self._events)-1)

    def _on_move(self, x, y):
        if not self._recording: return
        now = time.time()
        if now - self._last_mouse_move < 0.25: return
        self._last_mouse_move = now
        if self._record_origin is None: self._record_origin = (x, y)
        t = self._elapsed()
        ev = {'time': round(t*1000), 'type': 'mouse_move', 'x': x, 'y': y}
        self._events.append(ev)
        self.after(0, self._tree_insert_live, ev, len(self._events)-1)

    # ── Playback ──────────────────────────────────────────────────────────────

    def _toggle_play(self):
        if self._playing: self._abort_play()
        else: self._play_back()

    def _play_back(self):
        if not self._events:
            messagebox.showinfo('Nothing to play', 'Record something first.'); return
        if not PYNPUT_OK:
            messagebox.showerror('Missing dependency', 'pip install pynput'); return
        if self._recording:
            messagebox.showwarning('Still recording', 'Stop recording first.'); return
        self._stop_evt.clear()
        self._playing = True
        self._play_btn.configure(text='■  STOP', fg=RED)
        self._status_dot.configure(fg=GREEN)
        threading.Thread(target=self._do_playback, daemon=True).start()

    def _abort_play(self):
        self._stop_evt.set()

    def _do_playback(self):
        from pynput.keyboard import Controller as KbCtrl, Key
        from pynput.mouse import Controller as MsCtrl, Button

        speed    = SPEED_VALUES.get(self._speed_var.get(), 1.0)
        repeats  = max(1, self._repeat_var.get())
        rel      = self._rel_mouse_var.get()
        btn_map  = {'left': Button.left, 'right': Button.right, 'middle': Button.middle}

        # Countdown
        if self._countdown_var.get():
            for n in (3, 2, 1):
                if self._stop_evt.is_set(): break
                self.after(0, lambda n=n: self._status_var.set(f'Starting in {n}…'))
                self._stop_evt.wait(1.0)

        if self._stop_evt.is_set():
            self.after(0, self._on_play_done); return

        # Relative mouse offset
        ox, oy = 0, 0
        if rel and self._record_origin:
            curr = MsCtrl().position
            ox = curr[0] - self._record_origin[0]
            oy = curr[1] - self._record_origin[1]

        kb = KbCtrl(); ms = MsCtrl()

        for rep in range(repeats):
            if self._stop_evt.is_set(): break
            self.after(0, lambda r=rep+1: self._status_var.set(
                f'▶ Playing — run {r}/{repeats}…'))
            prev_t = 0

            for ev in self._events:
                if self._stop_evt.is_set(): break
                raw_delay = (ev['time'] - prev_t) / 1000.0
                delay = raw_delay / speed if speed > 0 else 0
                if delay > 0 and self._stop_evt.wait(delay):
                    break
                prev_t = ev['time']

                t = ev['type']
                if t == 'key':
                    combo    = ev['combo']; parts = combo.split('+')
                    base     = parts[-1];   mod_keys = []
                    for m in parts[:-1]:
                        mk = {'Ctrl':Key.ctrl,'Alt':Key.alt,
                              'Shift':Key.shift,'Meta':Key.cmd}.get(m)
                        if mk: kb.press(mk); mod_keys.append(mk)
                    try:
                        k = base.lower() if len(base)==1 else getattr(Key, base.lower(), base)
                        kb.press(k); kb.release(k)
                    except Exception: pass
                    for mk in reversed(mod_keys): kb.release(mk)

                elif t == 'mouse_click':
                    ms.position = (ev['x']+ox, ev['y']+oy)
                    ms.click(btn_map.get(ev.get('button','left'), Button.left))

                elif t == 'mouse_move':
                    ms.position = (ev['x']+ox, ev['y']+oy)

                elif t == 'mouse_scroll':
                    ms.scroll(ev.get('dx',0), ev.get('dy',0))

                elif t == 'wait':
                    wait_s = ev.get('ms', 0) / 1000.0 / speed
                    if wait_s > 0: self._stop_evt.wait(wait_s)

        self.after(0, self._on_play_done)

    def _on_play_done(self):
        self._playing = False
        self._play_btn.configure(text='▶  PLAY', fg=TEXT)
        if self._stop_evt.is_set():
            self._status_var.set('Playback stopped')
            self._status_dot.configure(fg=MUTED)
        else:
            self._status_var.set('Playback complete')
            self._status_dot.configure(fg=GREEN)

    # ── Hotkey ────────────────────────────────────────────────────────────────

    def _toggle_hotkey(self):
        if self._hotkey_var.get():
            self._start_hotkey()
        else:
            self._stop_hotkey()

    def _start_hotkey(self):
        if not PYNPUT_OK: self._hotkey_var.set(False); return
        try:
            self._hotkey_listener = keyboard.GlobalHotKeys(
                {'<f9>': self._hotkey_triggered})
            self._hotkey_listener.start()
            self._status_var.set('Hotkey F9 active — press F9 from any app to play')
        except Exception as e:
            self._hotkey_var.set(False)
            messagebox.showerror('Hotkey error', str(e))

    def _stop_hotkey(self):
        if self._hotkey_listener:
            self._hotkey_listener.stop(); self._hotkey_listener = None

    def _hotkey_triggered(self):
        if not self._recording and not self._playing:
            self.after(0, self._play_back)

    # ── Load / Export ─────────────────────────────────────────────────────────

    def _load(self):
        path = filedialog.askopenfilename(
            filetypes=[('JSON','*.json'),('All files','*.*')],
            title='Load macro')
        if not path: return
        try:
            with open(path) as f:
                data = json.load(f)
            events = data.get('events', data) if isinstance(data, dict) else data
            if not isinstance(events, list): raise ValueError('No events array found')
            self._push_undo()
            self._events = events
            self._record_origin = None
            self._refresh_table()
            self._status_var.set(f'Loaded {len(self._events)} events from {path}')
        except Exception as e:
            messagebox.showerror('Load failed', str(e))

    def _export(self):
        if not self._events:
            messagebox.showinfo('Nothing to export', 'Record something first.'); return
        path = filedialog.asksaveasfilename(
            defaultextension='.json', filetypes=[('JSON','*.json'),('All files','*.*')],
            initialfile='macro.json', title='Export macro')
        if not path: return
        payload = {'version':'1.0',
                   'duration_ms': self._events[-1]['time'] if self._events else 0,
                   'event_count': len(self._events),
                   'events': self._events}
        with open(path,'w') as f:
            json.dump(payload, f, indent=2)
        self._status_var.set(f'Exported → {path}')
        messagebox.showinfo('Exported', f'Saved {len(self._events)} events to:\n{path}')

    # ── Always on top ─────────────────────────────────────────────────────────

    def _toggle_ontop(self):
        self._ontop_var.set(not self._ontop_var.get())
        on = self._ontop_var.get()
        self.attributes('-topmost', on)
        self._ontop_btn.configure(fg=ACCENT if on else MUTED)

    # ── System tray ───────────────────────────────────────────────────────────

    def _send_to_tray(self):
        if not TRAY_OK:
            messagebox.showinfo('Not available',
                                'pip install pystray Pillow to enable tray support')
            return
        self.withdraw()
        img = Image.new('RGB', (64,64), '#0f1e24')
        d   = ImageDraw.Draw(img)
        d.ellipse([16,16,48,48], fill='#e05050')
        menu = pystray.Menu(
            pystray.MenuItem('Show', self._show_from_tray, default=True),
            pystray.MenuItem('Quit', lambda: self.after(0, self._quit_app)))
        self._tray_icon = pystray.Icon('StitchKeys', img,
                                       'Stitch Keys Macro Recorder', menu)
        threading.Thread(target=self._tray_icon.run, daemon=True).start()

    def _show_from_tray(self, icon=None, item=None):
        if self._tray_icon:
            self._tray_icon.stop(); self._tray_icon = None
        self.after(0, self.deiconify)

    # ── Clear ─────────────────────────────────────────────────────────────────

    def _clear(self):
        if self._recording: self._stop_record()
        if self._playing:   self._abort_play()
        self._push_undo()
        self._events = []
        for item in self._tree.get_children(): self._tree.delete(item)
        self._status_var.set('Cleared — click ● REC to start')
        self._status_dot.configure(fg=MUTED)
        self._count_var.set('0 events')
        self._duration_var.set('Total: 0.0s')

    # ── Quit ──────────────────────────────────────────────────────────────────

    def _quit_app(self):
        if self._recording: self._stop_record()
        if self._playing:   self._abort_play()
        self._stop_hotkey()
        self.destroy()

    def _on_close(self):
        self._quit_app()


if __name__ == '__main__':
    app = MacroRecorder()
    app.mainloop()
