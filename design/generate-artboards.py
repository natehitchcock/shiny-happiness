import os, json
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)))

FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap">'

CSS = """
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--ink-900);color:var(--ink-100);
  font-family:Archivo,'Helvetica Neue',sans-serif;-webkit-font-smoothing:antialiased}
:root{
  --ink-900:#0e0d0c; --ink-850:#141312; --ink-800:#1a1918; --ink-780:#1f1d1b;
  --ink-750:#232120; --ink-700:#2c2926; --ink-650:#35322e; --ink-600:#413d38;
  --ink-500:#5a554e; --ink-400:#847d74; --ink-300:#a9a199; --ink-200:#cbc4bb;
  --ink-100:#eae4dc;
  --amber:#e0a24a; --amber-2:#c2853a; --amber-3:#8a6428; --amber-ink:#2a1c07;
  --good:#7a9e6b; --warn:#d4863f; --danger:#c4584a;
  --mW:#ede4cf; --mU:#5182b0; --mB:#4b4550; --mR:#b0503f; --mG:#4f8558;
}
a{color:var(--amber);text-decoration:none} a:hover{color:var(--amber-2)}
.mono{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.disp{font-family:'Space Grotesk',Archivo,sans-serif}
.lbl{font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-400);font-weight:600}

/* ---- chrome ---- */
.bar{background:var(--ink-850);border-bottom:1px solid var(--ink-700)}
.bar-r1{display:flex;align-items:center;gap:14px;padding:12px 18px}
.bar-r2{display:flex;align-items:center;gap:6px;padding:0 18px 11px}
.cmdr{display:flex;align-items:center;gap:10px;padding:5px 10px 5px 5px;border-radius:7px;
  border:1px solid var(--ink-650);background:var(--ink-800);cursor:pointer}
.cmdr-art{width:38px;height:38px;border-radius:5px;flex:none;
  background:linear-gradient(150deg,#8e3a26,#c26a3a 45%,#5c2318);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)}
.cmdr-nm{font-family:'Space Grotesk',sans-serif;font-size:14.5px;font-weight:600;line-height:1.15}
.cmdr-sub{font-size:10.5px;color:var(--ink-400);margin-top:2px;letter-spacing:.02em}
.chev{color:var(--ink-400);font-size:10px;margin-left:2px}
.chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:6px;
  border:1px solid var(--ink-650);background:var(--ink-800);font-size:12px;color:var(--ink-200)}
.chip.warnish{border-color:#6a4a1e;background:#241a0c;color:var(--warn)}
.count{font-size:20px;font-weight:600;letter-spacing:-.02em}
.count small{font-size:12px;color:var(--ink-400);font-weight:400}
.zoom{display:flex;border:1px solid var(--ink-650);border-radius:7px;overflow:hidden;background:var(--ink-800)}
.zoom button{all:unset;width:36px;height:28px;display:grid;place-items:center;cursor:pointer;
  border-right:1px solid var(--ink-700)}
.zoom button:last-child{border-right:0}
.zoom .on{background:var(--amber);}
.zoom .on svg{color:var(--amber-ink)}
.zoom svg{color:var(--ink-300)}
.spacer{flex:1}

/* meters */
.meter{display:flex;flex-direction:column;gap:4px;padding:5px 11px 6px;border-radius:6px;
  border:1px solid transparent;min-width:88px;cursor:pointer}
.meter:hover{border-color:var(--ink-650);background:var(--ink-800)}
.meter-top{display:flex;align-items:baseline;gap:6px}
.meter-v{font-size:12px;font-weight:600;letter-spacing:.01em}
.meter-track{height:3px;border-radius:2px;background:var(--ink-700);overflow:hidden}
.meter-fill{height:100%;border-radius:2px;background:var(--ink-500)}
.meter.short .meter-v{color:var(--warn)} .meter.short .meter-fill{background:var(--warn)}
.meter.ok .meter-fill{background:var(--good)}
.mdiv{width:1px;height:26px;background:var(--ink-700);margin:0 4px}

/* ---- panes ---- */
.work{display:flex;height:calc(100% - 92px)}
.pane{display:flex;flex-direction:column;min-width:0;overflow:hidden}
.pane-hd{display:flex;align-items:center;gap:10px;padding:11px 16px 10px;border-bottom:1px solid var(--ink-780)}
.pane-body{overflow:hidden;padding:0 16px 16px;flex:1}
.vdiv{width:1px;background:var(--ink-700);position:relative;flex:none}
.vdiv::after{content:'';position:absolute;top:50%;left:-2px;width:5px;height:34px;border-radius:3px;
  background:var(--ink-600);transform:translateY(-50%)}
.mini{all:unset;display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border-radius:5px;
  border:1px solid var(--ink-650);background:var(--ink-800);font-size:11px;color:var(--ink-300);cursor:pointer}

/* group */
.grp{margin-top:14px}
.grp-hd{display:flex;align-items:center;gap:8px;padding:7px 2px 6px;border-bottom:1px solid var(--ink-780)}
.grp-nm{font-size:12.5px;font-weight:600;color:var(--ink-200);letter-spacing:.005em}
.grp-ct{margin-left:auto;font-size:11.5px;color:var(--ink-400);font-weight:500}
.grp-why{font-size:10.5px;color:var(--ink-500);margin:5px 2px 0;line-height:1.4}
.caret{color:var(--ink-500);font-size:9px;width:9px}
.dot{width:6px;height:6px;border-radius:50%;flex:none}
.row{display:flex;gap:9px;flex-wrap:wrap;margin-top:11px}

/* ---- card L2 ---- */
.c2{width:150px;border-radius:8px;background:var(--ink-780);border:1px solid var(--ink-650);
  padding:5px;position:relative;flex:none;box-shadow:0 1px 3px rgba(0,0,0,.45)}
.c2-hd{display:flex;align-items:center;gap:4px;padding:1px 2px 4px}
.c2-nm{font-size:9.5px;font-weight:600;color:var(--ink-100);overflow:hidden;white-space:nowrap;
  text-overflow:ellipsis;letter-spacing:.01em}
.c2-cost{margin-left:auto;display:flex;gap:2px;flex:none}
.pip{width:9px;height:9px;border-radius:50%;box-shadow:inset 0 -1px 1px rgba(0,0,0,.3)}
.c2-art{height:78px;border-radius:3px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.5)}
.c2-tl{font-size:8px;color:var(--ink-400);padding:4px 2px 3px;overflow:hidden;white-space:nowrap;
  text-overflow:ellipsis}
.c2-tx{background:var(--ink-800);border-radius:3px;padding:5px;display:flex;flex-direction:column;gap:3px;height:40px}
.c2-tx i{display:block;height:2px;border-radius:1px;background:var(--ink-650)}
.badge{position:absolute;top:-6px;right:-6px;height:20px;min-width:20px;padding:0 5px;border-radius:10px;
  background:var(--amber);color:var(--amber-ink);font-size:11px;font-weight:600;display:flex;
  align-items:center;justify-content:center;gap:3px;box-shadow:0 2px 5px rgba(0,0,0,.5);
  font-family:'IBM Plex Mono',monospace}
.badge.d2{background:var(--amber-2)} .badge.d1{background:var(--amber-3);color:#e8d5b0}
.flag{position:absolute;top:-6px;left:-6px;width:20px;height:20px;border-radius:50%;background:#3a2408;
  border:1px solid #7a5620;display:grid;place-items:center;box-shadow:0 2px 5px rgba(0,0,0,.5)}
.lock{position:absolute;bottom:5px;right:5px;width:16px;height:16px;border-radius:4px;
  background:rgba(14,13,12,.85);display:grid;place-items:center}

/* ---- card L1 ---- */
.c1{width:96px;flex:none;position:relative}
.c1-art{height:58px;border-radius:4px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.5)}
.c1-nm{font-size:8.5px;color:var(--ink-300);margin-top:4px;line-height:1.25;overflow:hidden;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;height:22px}
.c1-b{position:absolute;top:-4px;right:-4px;height:16px;min-width:16px;padding:0 4px;border-radius:8px;
  background:var(--amber);color:var(--amber-ink);font-size:9.5px;font-weight:600;display:grid;
  place-items:center;font-family:'IBM Plex Mono',monospace}
.c1-b.d2{background:var(--amber-2)} .c1-b.d1{background:var(--amber-3);color:#e8d5b0}

/* ---- L0 ---- */
.cl{padding:14px 4px 0}
.cl-hd{display:flex;align-items:baseline;gap:8px;margin-bottom:9px}
.cl-nm{font-size:11px;font-weight:600;color:var(--ink-300)}
.cl-ct{font-size:10px;color:var(--ink-500)}
.cl-field{display:flex;flex-wrap:wrap;gap:4px;align-content:flex-start}
.px{border-radius:50%}

/* ---- inspect ---- */
.insp{width:392px;flex:none;background:var(--ink-850);border-left:1px solid var(--ink-700);
  display:flex;flex-direction:column}
.insp-hd{display:flex;align-items:center;gap:9px;padding:13px 16px;border-bottom:1px solid var(--ink-780)}
.insp-b{padding:16px;overflow:hidden;flex:1}
.reason{display:flex;gap:9px;padding:10px 0;border-bottom:1px solid var(--ink-780)}
.reason-i{width:19px;height:19px;border-radius:5px;flex:none;display:grid;place-items:center;margin-top:1px}
.reason-t{font-size:11.5px;line-height:1.5;color:var(--ink-200)}
.reason-t b{color:var(--ink-100);font-weight:600}
.combo-line{font-size:10.5px;color:var(--ink-400);line-height:1.55;padding-left:1px;margin-top:5px}
.combo-line em{color:var(--amber);font-style:normal}
.act{display:flex;gap:8px;padding:13px 16px;border-top:1px solid var(--ink-700);background:var(--ink-800)}
.btn{all:unset;flex:1;height:38px;border-radius:7px;display:grid;place-items:center;font-size:12.5px;
  font-weight:600;cursor:pointer;text-align:center}
.btn-p{background:var(--amber);color:var(--amber-ink)}
.btn-s{border:1px solid var(--ink-650);color:var(--ink-300)}

/* ---- mobile ---- */
.ph{width:390px;height:844px;background:var(--ink-900);display:flex;flex-direction:column;
  position:relative;overflow:hidden}
.ph-bar{padding:52px 14px 0;background:var(--ink-850);border-bottom:1px solid var(--ink-700)}
.ph-r1{display:flex;align-items:center;gap:10px;padding-bottom:10px}
.ph-r2{display:flex;gap:5px;padding-bottom:10px;overflow:hidden}
.ph-m{flex:1;min-width:0}
.ph-m .meter-top{gap:4px} .ph-m .lbl{font-size:8.5px;letter-spacing:.07em}
.ph-m .meter-v{font-size:10.5px}
.sheet{position:absolute;left:0;right:0;bottom:0;background:var(--ink-820,#1c1a19);
  border-top:1px solid var(--ink-650);border-radius:15px 15px 0 0;
  box-shadow:0 -10px 34px rgba(0,0,0,.6);display:flex;flex-direction:column}
.grab{width:36px;height:4px;border-radius:2px;background:var(--ink-600);margin:9px auto 0;flex:none}
.sheet-hd{display:flex;align-items:center;gap:9px;padding:10px 15px 11px}
.swipe{position:absolute;inset:0;border-radius:8px;pointer-events:none}

/* library */
.lib{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px}
.deck{border-radius:9px;border:1px solid var(--ink-700);background:var(--ink-800);overflow:hidden}
.deck-art{height:96px;position:relative}
.deck-b{padding:11px 12px 12px}
.deck-nm{font-family:'Space Grotesk',sans-serif;font-size:13.5px;font-weight:600;line-height:1.2}
.deck-sub{font-size:10.5px;color:var(--ink-400);margin-top:3px}
.deck-ft{display:flex;align-items:center;gap:7px;margin-top:10px}
.bar-mini{flex:1;height:3px;border-radius:2px;background:var(--ink-700);overflow:hidden}
.bar-mini i{display:block;height:100%;background:var(--amber-3);border-radius:2px}
.ci{display:flex;gap:2px}

/* switcher */
.pop{width:340px;border-radius:10px;border:1px solid var(--ink-650);background:var(--ink-800);
  box-shadow:0 18px 44px rgba(0,0,0,.66);overflow:hidden}
.pop-hd{display:flex;align-items:center;padding:11px 13px 10px;border-bottom:1px solid var(--ink-750)}
.srow{display:flex;align-items:center;gap:10px;padding:9px 13px;cursor:pointer;border-left:2px solid transparent}
.srow:hover{background:var(--ink-780)}
.srow.cur{background:var(--ink-780);border-left-color:var(--amber)}
.srow-art{width:34px;height:34px;border-radius:5px;flex:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)}
.srow-nm{font-size:12.5px;font-weight:600;color:var(--ink-100)}
.srow-sub{font-size:10px;color:var(--ink-400);margin-top:2px}
.kbd{font-family:'IBM Plex Mono',monospace;font-size:9.5px;color:var(--ink-500);
  border:1px solid var(--ink-650);border-radius:3px;padding:1px 4px;margin-left:auto}
.pop-ft{padding:9px 13px;border-top:1px solid var(--ink-750);display:flex;align-items:center}
"""

ART = {
 "R":  "linear-gradient(150deg,#8e3a26,#c4703c 48%,#4e1e14)",
 "R2": "linear-gradient(150deg,#6d2b1e,#a5543a 50%,#3d1710)",
 "R3": "linear-gradient(160deg,#a04a2a,#d08a4a 42%,#5a2415)",
 "C":  "linear-gradient(150deg,#4a4640,#8b8177 48%,#2e2b27)",
 "C2": "linear-gradient(155deg,#575049,#948a7e 45%,#332f2b)",
 "W":  "linear-gradient(150deg,#a89c7e,#ede4cf 50%,#6e6553)",
 "U":  "linear-gradient(150deg,#2f5a80,#5182b0 48%,#1d3850)",
 "B":  "linear-gradient(150deg,#332e38,#4b4550 48%,#1c1920)",
 "G":  "linear-gradient(150deg,#31563a,#4f8558 48%,#1f3524)",
 "WUBRG":"linear-gradient(120deg,#ede4cf,#5182b0 26%,#4b4550 50%,#b0503f 74%,#4f8558)",
 "GW": "linear-gradient(150deg,#4f8558,#ede4cf 55%,#31563a)",
 "UB": "linear-gradient(150deg,#5182b0,#4b4550 55%,#1d3850)",
}

def svg(p, s=13, sw=1.6):
    return ('<svg width="%d" height="%d" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="%s" stroke-linecap="round" stroke-linejoin="round">%s</svg>' % (s, s, sw, p))

I_GRID2 = svg('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>', 13)
I_GRID4 = svg('<rect x="3" y="3" width="4" height="4" rx=".7"/><rect x="10" y="3" width="4" height="4" rx=".7"/><rect x="17" y="3" width="4" height="4" rx=".7"/><rect x="3" y="10" width="4" height="4" rx=".7"/><rect x="10" y="10" width="4" height="4" rx=".7"/><rect x="17" y="10" width="4" height="4" rx=".7"/><rect x="3" y="17" width="4" height="4" rx=".7"/><rect x="10" y="17" width="4" height="4" rx=".7"/><rect x="17" y="17" width="4" height="4" rx=".7"/>', 13)
I_DOTS = ('<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">'
          '<circle cx="4" cy="4" r="1.5"/><circle cx="10" cy="4" r="1.5"/><circle cx="16" cy="4" r="1.5"/><circle cx="22" cy="4" r="1.5"/>'
          '<circle cx="4" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="16" cy="10" r="1.5"/><circle cx="22" cy="10" r="1.5"/>'
          '<circle cx="4" cy="16" r="1.5"/><circle cx="10" cy="16" r="1.5"/><circle cx="16" cy="16" r="1.5"/><circle cx="22" cy="16" r="1.5"/>'
          '<circle cx="4" cy="22" r="1.5"/><circle cx="10" cy="22" r="1.5"/><circle cx="16" cy="22" r="1.5"/><circle cx="22" cy="22" r="1.5"/></svg>')
I_CARD1 = svg('<rect x="7" y="3" width="10" height="18" rx="1.5"/><path d="M9 8h6M9 12h6"/>', 13)
I_WARN = svg('<path d="M12 4 3 19h18L12 4z"/><path d="M12 10v4M12 17h.01"/>', 11, 1.8)
I_LOCK = svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 10, 2)
I_LINK = svg('<circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="6" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M8.4 10.8 15.6 7.2M8.4 13.2l7.2 3.6"/>', 12, 1.7)
I_CHART = svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', 12, 1.7)
I_GAP = svg('<path d="M12 5v14M5 12h14"/>', 12, 2)
I_SEARCH = svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4.3-4.3"/>', 13)
I_FILTER = svg('<path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/>', 12)
I_PLUS = svg('<path d="M12 5v14M5 12h14"/>', 13, 2)
I_CHECK = svg('<path d="m5 13 4 4L19 7"/>', 12, 2.2)
I_X = svg('<path d="M6 6l12 12M18 6L6 18"/>', 12, 2)

def pips(cost):
    m = {"R":"var(--mR)","W":"var(--mW)","U":"var(--mU)","B":"var(--mB)","G":"var(--mG)","C":"#6e675e"}
    return "".join('<span class="pip" style="background:%s"></span>' % m.get(c, "#6e675e") for c in cost)

def c2(nm, cost, tl, art, deg=0, flag=False, lock=False):
    b = ""
    if deg:
        cls = "" if deg >= 3 else (" d2" if deg == 2 else " d1")
        b = '<span class="badge%s">%s</span>' % (cls, deg)
    f = '<span class="flag" style="color:var(--warn)">%s</span>' % I_WARN if flag else ""
    lk = '<span class="lock" style="color:var(--ink-400)">%s</span>' % I_LOCK if lock else ""
    return ('<div class="c2">%s%s<div class="c2-hd"><span class="c2-nm">%s</span>'
            '<span class="c2-cost">%s</span></div>'
            '<div class="c2-art" style="background:%s"></div>'
            '<div class="c2-tl">%s</div>'
            '<div class="c2-tx"><i style="width:96%%"></i><i style="width:78%%"></i>'
            '<i style="width:88%%"></i><i style="width:52%%"></i></div>%s</div>'
            % (b, f, nm, pips(cost), ART[art], tl, lk))

def c1(nm, art, deg=0):
    b = ""
    if deg:
        cls = "" if deg >= 3 else (" d2" if deg == 2 else " d1")
        b = '<span class="c1-b%s">%s</span>' % (cls, deg)
    return ('<div class="c1">%s<div class="c1-art" style="background:%s"></div>'
            '<div class="c1-nm">%s</div></div>' % (b, ART[art], nm))

def meter(lbl, cur, ideal, state=""):
    pct = min(100, round(cur / ideal * 100))
    return ('<div class="meter %s"><div class="meter-top"><span class="lbl">%s</span>'
            '<span class="meter-v mono">%d/%d</span></div>'
            '<div class="meter-track"><span class="meter-fill" style="width:%d%%"></span></div></div>'
            % (state, lbl, cur, ideal, pct))

def zoomctl(active):
    ic = [I_DOTS, I_GRID4, I_GRID2, I_CARD1]
    return ('<div class="zoom">' + "".join(
        '<button class="%s">%s</button>' % ("on" if i == active else "", ic[i]) for i in range(4)) + '</div>')

def grp(nm, ct, why="", dotc=None, open_=True):
    d = '<span class="dot" style="background:%s"></span>' % dotc if dotc else ""
    h = ('<div class="grp-hd"><span class="caret">%s</span>%s<span class="grp-nm">%s</span>'
         '<span class="grp-ct mono">%s</span></div>' % ("▾" if open_ else "▸", d, nm, ct))
    if why:
        h += '<div class="grp-why">%s</div>' % why
    return h

def wrap(body, css_extra="", script=""):
    return ('<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n'
            '  <script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n'
            '<helmet>\n  %s\n  <style>%s%s</style>\n</helmet>\n%s\n</x-dc>\n%s\n</body>\n</html>\n'
            % (FONTS, CSS, css_extra, body, script))

def write(name, body, css_extra="", script=""):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(wrap(body, css_extra, script))
    print("wrote", name)

# ============================ shared desktop chrome ============================
def cmdbar(zoom=2, count=64):
    return ('<div class="bar">'
      '<div class="bar-r1">'
        '<div class="cmdr"><span class="cmdr-art"></span><span>'
          '<span class="cmdr-nm">Krenko, Mob Boss</span>'
          '<span class="cmdr-sub">Goblins, all the way down</span></span>'
          '<span class="chev">▾</span></div>'
        '<span class="chip">Bracket 3 <span class="chev">▾</span></span>'
        '<span class="chip warnish">%s 4/3 Game Changers</span>'
        '<span class="spacer"></span>'
        '<span class="chip" style="border:0;background:transparent;padding:0 4px">'
          '<span class="lbl">Combos</span><span class="mono" style="font-size:14px;font-weight:600;color:var(--amber)">14</span></span>'
        '<span class="count mono">%d<small>/100</small></span>'
        '%s'
      '</div>'
      '<div class="bar-r2">'
        '%s%s%s<span class="mdiv"></span>%s%s%s'
        '<span class="spacer"></span>'
        '<span class="lbl" style="color:var(--ink-500)">avg MV <span class="mono" style="color:var(--ink-300)">2.94</span></span>'
      '</div></div>'
      % (I_WARN, count, zoomctl(zoom),
         meter("Lands", 34, 36, "short"), meter("Ramp", 8, 11, "short"),
         meter("Draw", 6, 9, "short"), meter("Interaction", 5, 8, "short"),
         meter("Wipes", 3, 3, "ok"), meter("Wincons", 4, 4, "ok")))

def accepted_hd():
    return ('<div class="pane-hd"><span class="lbl">Accepted</span>'
            '<span class="mono" style="font-size:11px;color:var(--ink-500)">64</span>'
            '<span class="spacer"></span>'
            '<button class="mini">Group: Role <span class="chev">▾</span></button></div>')

def cand_hd():
    return ('<div class="pane-hd"><span class="lbl">Candidates</span>'
            '<span class="mono" style="font-size:11px;color:var(--ink-500)">248</span>'
            '<span class="spacer"></span>'
            '<button class="mini">%s Filters</button>'
            '<button class="mini">%s Weights</button></div>' % (I_FILTER, I_CHART))

# ============================ Main — desktop L2 ============================
acc2 = ('<div class="grp">' + grp("Core · Bracket 3", 24, dotc="var(--amber-3)") +
  '<div class="row">' +
    c2("Sol Ring","C","Artifact","C",lock=True) +
    c2("Arcane Signet","C","Artifact","C2") +
    c2("Jeska's Will","RR","Sorcery","R2",deg=0,flag=True) +
    c2("Deflecting Swat","R","Instant","R3",flag=True) +
  '</div></div>' +
  '<div class="grp">' + grp("Win conditions", 4) +
  '<div class="row">' +
    c2("Purphoros, God of the Forge","RR","Legendary Creature — God","R3",lock=True) +
    c2("Goblin Bombardment","R","Enchantment","R2") +
    c2("Zealous Conscripts","RR","Creature — Human Berserker","R") +
    c2("Skirk Prospector","R","Creature — Goblin","R2") +
  '</div></div>' +
  '<div class="grp">' + grp("Ramp", 8, open_=False) + '</div>' +
  '<div class="grp">' + grp("Interaction", 5, open_=False) + '</div>' +
  '<div class="grp" style="margin-top:16px">' +
  '<div class="grp-hd" style="border:0"><span class="caret">▸</span>'
  '<span class="grp-nm" style="color:var(--ink-500)">Removed from core</span>'
  '<span class="grp-ct mono">3</span></div></div>')

can2 = ('<div class="grp">' + grp("Completes 3+ combos", 6, "Adding one of these finishes three or more combos using only cards already in your deck.", "var(--amber)") +
  '<div class="row">' +
    c2("Kiki-Jiki, Mirror Breaker","2RRR","Legendary Creature — Goblin Shaman","R3",deg=3,flag=True) +
    c2("Thornbite Staff","2","Artifact — Equipment","C2",deg=3) +
    c2("Ashnod's Altar","3","Artifact","C",deg=3) +
  '</div></div>' +
  '<div class="grp">' + grp("Completes 2 combos", 14, "Counts two <em style='font-style:normal;color:var(--ink-400)'>distinct</em> combos — one with your commander, one with another accepted card.", "var(--amber-2)") +
  '<div class="row">' +
    c2("Combat Celebrant","2R","Creature — Human Warrior","R",deg=2) +
    c2("Goblin Sharpshooter","2R","Creature — Goblin","R2",deg=2) +
    c2("Umbral Mantle","3","Artifact — Equipment","C2",deg=2) +
  '</div></div>' +
  '<div class="grp">' + grp("Fills gap · Ramp −3", 22, "You are three short of the 11 ramp sources typical for this curve.", "var(--warn)") +
  '<div class="row">' +
    c2("Mind Stone","2","Artifact","C") +
    c2("Thran Dynamo","4","Artifact","C2") +
    c2("Wayfarer's Bauble","1","Artifact","C") +
  '</div></div>' +
  '<div class="grp">' + grp("Top sorceries · EDHREC", 10, open_=False) + '</div>' +
  '<div class="grp">' + grp("High synergy", 50, open_=False) + '</div>' +
  '<div class="grp">' + grp("Staples", 120, open_=False) + '</div>')

write("Main.dc.html",
  '<div style="width:1440px;height:900px;display:flex;flex-direction:column;overflow:hidden">'
  + cmdbar(2) +
  '<div class="work">'
    '<div class="pane" style="width:46%%">%s<div class="pane-body">%s</div></div>'
    '<div class="vdiv"></div>'
    '<div class="pane" style="flex:1">%s<div class="pane-body">%s</div></div>'
  '</div></div>' % (accepted_hd(), acc2, cand_hd(), can2))

# ============================ ZoomGrid — desktop L1 ============================
G_ACC = [("Sol Ring","C"),("Arcane Signet","C2"),("Commander's Sphere","C"),("Jeska's Will","R2"),
  ("Deflecting Swat","R3"),("Chaos Warp","R"),("Vandalblast","R2"),("Blasphemous Act","R3"),
  ("Skullclamp","C2"),("Goblin Recruiter","R"),("Conspicuous Snout","R2"),("Krenko's Command","R3"),
  ("Purphoros, God of the Forge","R3"),("Goblin Bombardment","R2"),("Zealous Conscripts","R"),
  ("Skirk Prospector","R2"),("Impact Tremors","R3"),("Goblin Chieftain","R"),
  ("Mountain","R2"),("Mountain","R2"),("Mountain","R2"),("Mountain","R2"),("Mountain","R2"),("Mountain","R2")]

G_C3 = [("Kiki-Jiki, Mirror Breaker","R3",3),("Thornbite Staff","C2",3),("Ashnod's Altar","C",3),
  ("Phyrexian Altar","C2",3),("Goblin Welder","R",3),("Sneak Attack","R2",3)]
G_C2 = [("Combat Celebrant","R",2),("Goblin Sharpshooter","R2",2),("Umbral Mantle","C2",2),
  ("Pashalik Mons","R3",2),("Mana Echoes","R",2),("Brash Taunter","R2",2),("Terror of the Peaks","R3",2),
  ("Sling-Gang Lieutenant","R",2),("Krenko, Tin Street Kingpin","R2",2),("Goblin Warchief","R3",2),
  ("Boggart Trawler","R",2),("Mogg Fanatic","R2",2),("Siege-Gang Commander","R3",2),("Beetleback Chief","R",2)]
G_C1 = [("Impact Tremors","R3",1),("Goblin King","R",1),("Muxus, Goblin Grandee","R2",1),
  ("Goblin Matron","R3",1),("Krenko's Way","R",1),("Goblin Piledriver","R2",1),
  ("Reckless Bushwhacker","R3",1),("Hordeling Outburst","R",1),("Dragon Fodder","R2",1),
  ("Goblin Instigator","R3",1),("Legion Warboss","R",1),("Goblin Rabblemaster","R2",1)]

def gridrow(items):
    out = []
    for it in items:
        if len(it) == 3: out.append(c1(it[0], it[1], it[2]))
        else: out.append(c1(it[0], it[1]))
    return '<div class="row" style="gap:11px">' + "".join(out) + '</div>'

accG = ('<div class="grp">' + grp("Core · Bracket 3", 24, dotc="var(--amber-3)") + gridrow(G_ACC[:12]) + '</div>'
  '<div class="grp">' + grp("Ramp", 8) + gridrow(G_ACC[12:18]) + '</div>'
  '<div class="grp">' + grp("Lands", 34) + gridrow(G_ACC[18:]) + '</div>')

canG = ('<div class="grp">' + grp("Completes 3+ combos", 6, "", "var(--amber)") + gridrow(G_C3) + '</div>'
  '<div class="grp">' + grp("Completes 2 combos", 14, "", "var(--amber-2)") + gridrow(G_C2) + '</div>'
  '<div class="grp">' + grp("Completes 1 combo", 38, "", "var(--amber-3)") + gridrow(G_C1) + '</div>'
  '<div class="grp">' + grp("Fills gap · Ramp −3", 22, "", "var(--warn)", open_=False) + '</div>')

write("ZoomGrid.dc.html",
  '<div style="width:1440px;height:900px;display:flex;flex-direction:column;overflow:hidden">'
  + cmdbar(1) +
  '<div class="work">'
    '<div class="pane" style="width:46%%">%s<div class="pane-body">%s</div></div>'
    '<div class="vdiv"></div>'
    '<div class="pane" style="flex:1">%s<div class="pane-body">%s</div></div>'
  '</div></div>' % (accepted_hd(), accG, cand_hd(), canG))

# ============================ ZoomConstellation — desktop L0 ============================
L0_SCRIPT = """<script data-dc-script>
class Component extends DCLogic {
  rng(seed){ let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  cluster(name, count, tone, seed){
    const r = this.rng(seed), pips = [];
    for (let i = 0; i < count; i++){
      const d = r(), sz = 6 + Math.round(r() * 3);
      let bg = tone.base, op = 0.55 + d * 0.45;
      if (tone.heat && d > 1 - tone.heat) bg = tone.hot;
      pips.push({ id: name + '-' + i,
        s: 'width:' + sz + 'px;height:' + sz + 'px;background:' + bg + ';opacity:' + op.toFixed(2) });
    }
    return { name, count, pips };
  }
  renderVals(){
    const DIM = { base: '#4a4640' }, WARM = { base: '#6b5c46' };
    const HOT3 = { base: '#8a6428', hot: '#e0a24a', heat: 0.75 };
    const HOT2 = { base: '#7a5a28', hot: '#c2853a', heat: 0.45 };
    const HOT1 = { base: '#5e4c30', hot: '#8a6428', heat: 0.3 };
    const GAP  = { base: '#6b5230', hot: '#d4863f', heat: 0.35 };
    return {
      accepted: [
        this.cluster('Lands', 34, DIM, 11), this.cluster('Ramp', 8, WARM, 22),
        this.cluster('Draw', 6, WARM, 33), this.cluster('Interaction', 5, WARM, 44),
        this.cluster('Board wipes', 3, WARM, 55), this.cluster('Win conditions', 4, HOT2, 66),
        this.cluster('Synergy', 4, HOT1, 77)
      ],
      candidates: [
        this.cluster('Completes 3+ combos', 6, HOT3, 101),
        this.cluster('Completes 2 combos', 14, HOT2, 202),
        this.cluster('Completes 1 combo', 38, HOT1, 303),
        this.cluster('One card away', 9, HOT1, 404),
        this.cluster('Fills gap · Ramp −3', 22, GAP, 505),
        this.cluster('Top sorceries · EDHREC', 10, WARM, 606),
        this.cluster('High synergy', 50, WARM, 707),
        this.cluster('Staples', 99, DIM, 808)
      ]
    };
  }
}
</script>"""

def l0pane(binding):
    return ('<sc-for list="{{%s}}" as="cl" hint-placeholder-count="4">'
            '<div class="cl"><div class="cl-hd"><span class="cl-nm">{{cl.name}}</span>'
            '<span class="cl-ct mono">{{cl.count}}</span></div>'
            '<div class="cl-field">'
            '<sc-for list="{{cl.pips}}" as="p" hint-placeholder-count="18">'
            '<span class="px" style="{{p.s}}"></span>'
            '</sc-for></div></div></sc-for>' % binding)

L0_EXTRA = """
.legend{display:flex;align-items:center;gap:13px;margin-left:auto}
.lg{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--ink-400)}
.lg span.px{width:8px;height:8px}
"""

l0_cand_hd = ('<div class="pane-hd"><span class="lbl">Candidates</span>'
  '<span class="mono" style="font-size:11px;color:var(--ink-500)">248</span>'
  '<span class="legend">'
    '<span class="lbl" style="color:var(--ink-500)">Colour by</span>'
    '<button class="mini">Combo degree <span class="chev">▾</span></button>'
    '<span class="lg"><span class="px" style="background:#e0a24a"></span>3+</span>'
    '<span class="lg"><span class="px" style="background:#c2853a"></span>2</span>'
    '<span class="lg"><span class="px" style="background:#8a6428"></span>1</span>'
    '<span class="lg"><span class="px" style="background:#4a4640"></span>0</span>'
  '</span></div>')

write("ZoomConstellation.dc.html",
  '<div style="width:1440px;height:900px;display:flex;flex-direction:column;overflow:hidden">'
  + cmdbar(0) +
  '<div class="work">'
    '<div class="pane" style="width:38%%">%s<div class="pane-body" style="padding-top:2px">%s</div></div>'
    '<div class="vdiv"></div>'
    '<div class="pane" style="flex:1">%s<div class="pane-body" style="padding-top:2px">%s</div></div>'
  '</div></div>' % (accepted_hd(), l0pane("accepted"), l0_cand_hd, l0pane("candidates")),
  css_extra=L0_EXTRA, script=L0_SCRIPT)

# ============================ Inspect — desktop L3 panel ============================
INSP_EXTRA = """
.bigcard{width:212px;border-radius:11px;background:var(--ink-780);border:1px solid var(--ink-650);
  padding:7px;position:relative;margin:0 auto 15px;box-shadow:0 5px 18px rgba(0,0,0,.5)}
.bigcard .c2-nm{font-size:12px} .bigcard .c2-art{height:112px;border-radius:4px}
.bigcard .c2-tl{font-size:9.5px;padding:6px 3px 5px}
.bigcard .c2-tx{height:66px;padding:8px} .bigcard .pip{width:11px;height:11px}
.bigcard .badge{height:26px;min-width:26px;font-size:13px;top:-9px;right:-9px}
.stat{display:flex;gap:14px;margin:12px 0 4px}
.stat div{flex:1}
.stat .v{font-size:16px;font-weight:600;letter-spacing:-.01em;margin-top:3px}
"""

def reason(icon, bg, col, html, sub=""):
    return ('<div class="reason"><span class="reason-i" style="background:%s;color:%s">%s</span>'
            '<span><span class="reason-t">%s</span>%s</span></div>'
            % (bg, col, icon, html, sub))

combo_lines = (
  '<div class="combo-line">→ <em>Kiki-Jiki</em> + Zealous Conscripts &nbsp;·&nbsp; infinite hasty copies</div>'
  '<div class="combo-line">→ <em>Kiki-Jiki</em> + Zealous Conscripts + Goblin Bombardment &nbsp;·&nbsp; infinite damage</div>'
  '<div class="combo-line">→ <em>Kiki-Jiki</em> + Zealous Conscripts + Purphoros &nbsp;·&nbsp; infinite damage</div>'
  '<div class="combo-line" style="color:var(--ink-600);margin-top:7px;font-size:10px">'
  'Three distinct combos, counted separately even though they share a piece.</div>')

insp_panel = ('<div class="insp">'
  '<div class="insp-hd"><span class="lbl">Inspect</span>'
  '<span class="spacer"></span><span style="color:var(--ink-400)">%s</span></div>'
  '<div class="insp-b">'
    '<div class="bigcard"><span class="badge">3</span>'
      '<div class="c2-hd"><span class="c2-nm">Kiki-Jiki, Mirror Breaker</span>'
      '<span class="c2-cost">%s</span></div>'
      '<div class="c2-art" style="background:%s"></div>'
      '<div class="c2-tl">Legendary Creature — Goblin Shaman</div>'
      '<div class="c2-tx"><i style="width:97%%"></i><i style="width:88%%"></i><i style="width:94%%"></i>'
      '<i style="width:71%%"></i><i style="width:44%%"></i></div></div>'
    '<div class="stat">'
      '<div><span class="lbl">Inclusion</span><div class="v mono">61%%</div></div>'
      '<div><span class="lbl">Synergy</span><div class="v mono" style="color:var(--good)">+0.44</div></div>'
      '<div><span class="lbl">Price</span><div class="v mono">$18</div></div>'
    '</div>'
    '<div style="margin-top:9px">%s%s%s</div>'
  '</div>'
  '<div class="act"><button class="btn btn-p">Add to deck</button>'
  '<button class="btn btn-s">Not for this deck</button></div>'
  '</div>' % (I_X, pips("2RRR"), ART["R3"],
    reason(I_LINK, "#3a2a10", "var(--amber)",
      'Completes <b>3 combos</b> with cards you have accepted', combo_lines),
    reason(I_CHART, "#22271e", "var(--good)",
      '<b>61%</b> of Krenko decks on EDHREC play it — synergy <b>+0.44</b>'),
    reason(I_WARN, "#33240c", "var(--warn)",
      '<b>Game Changer.</b> Your target Bracket 3 allows 3 and you already have 3. Adding this puts the deck at 4.',
      '<div class="combo-line" style="margin-top:6px">You can add it anyway — the bracket chip will show the overage.</div>')))

acc_narrow = ('<div class="grp">' + grp("Core · Bracket 3", 24, dotc="var(--amber-3)") +
  '<div class="row">' + c1("Sol Ring","C") + c1("Arcane Signet","C2") + c1("Commander's Sphere","C") +
  c1("Jeska's Will","R2") + c1("Deflecting Swat","R3") + c1("Chaos Warp","R") + '</div></div>'
  '<div class="grp">' + grp("Win conditions", 4) + '<div class="row">' +
  c1("Purphoros, God of the Forge","R3") + c1("Goblin Bombardment","R2") +
  c1("Zealous Conscripts","R") + c1("Skirk Prospector","R2") + '</div></div>'
  '<div class="grp">' + grp("Ramp", 8, open_=False) + '</div>'
  '<div class="grp">' + grp("Lands", 34, open_=False) + '</div>')

can_narrow = ('<div class="grp">' + grp("Completes 3+ combos", 6, "", "var(--amber)") +
  '<div class="row">' + c1("Kiki-Jiki, Mirror Breaker","R3",3) + c1("Thornbite Staff","C2",3) +
  c1("Ashnod's Altar","C",3) + c1("Phyrexian Altar","C2",3) + c1("Goblin Welder","R",3) + '</div></div>'
  '<div class="grp">' + grp("Completes 2 combos", 14, "", "var(--amber-2)") +
  '<div class="row">' + c1("Combat Celebrant","R",2) + c1("Goblin Sharpshooter","R2",2) +
  c1("Umbral Mantle","C2",2) + c1("Pashalik Mons","R3",2) + c1("Mana Echoes","R",2) + '</div></div>'
  '<div class="grp">' + grp("Completes 1 combo", 38, "", "var(--amber-3)", open_=False) + '</div>'
  '<div class="grp">' + grp("Fills gap · Ramp −3", 22, "", "var(--warn)", open_=False) + '</div>')

write("Inspect.dc.html",
  '<div style="width:1440px;height:900px;display:flex;flex-direction:column;overflow:hidden">'
  + cmdbar(1) +
  '<div class="work">'
    '<div class="pane" style="width:330px;flex:none">%s<div class="pane-body">%s</div></div>'
    '<div class="vdiv"></div>'
    '<div class="pane" style="flex:1">%s<div class="pane-body">%s</div></div>'
    '%s'
  '</div></div>' % (accepted_hd(), acc_narrow, cand_hd(), can_narrow, insp_panel),
  css_extra=INSP_EXTRA)

ART.update({
 "WUBG":"linear-gradient(120deg,#e2d9c4,#5182b0 32%,#4b4550 62%,#4f8558)",
 "GWB":"linear-gradient(125deg,#4f8558,#d8cfb8 46%,#3a3540)",
 "BR":"linear-gradient(140deg,#3a3540,#9c4738 58%,#241f28)",
 "BG":"linear-gradient(140deg,#3a3540,#4f8558 60%,#221e28)",
 "UBg":"linear-gradient(140deg,#2f5a80,#3a3540 58%,#1a1720)",
})
CI = {"W":"var(--mW)","U":"var(--mU)","B":"var(--mB)","R":"var(--mR)","G":"var(--mG)"}
def cipips(s):
    return '<span class="ci">' + "".join(
      '<span style="width:8px;height:8px;border-radius:50%%;background:%s;box-shadow:inset 0 -1px 1px rgba(0,0,0,.35)"></span>' % CI[c]
      for c in s) + '</span>'

DECKS = [
 ("Goblins, all the way down","Krenko, Mob Boss","R","R",3,64,14,"2 minutes ago",True,False),
 ("Superfriends pile","Atraxa, Grand Unifier","WUBG","WUBG",4,100,6,"yesterday",False,False),
 ("Turbo Thrasios","Tymna + Thrasios","WUBG","WUBG",5,98,22,"3 days ago",False,False),
 ("Drakes and counters","Talrand, Sky Summoner","U","U",2,87,1,"last week",False,False),
 ("Token soup","Ghave, Guru of Spores","GWB","GWB",4,100,11,"last week",False,False),
 ("Treasure & rats","Prosper, Tome-Bound","BR","BR",3,72,4,"2 weeks ago",False,False),
 ("Ninjas, obviously","Yuriko, the Tiger's Shadow","UB","UBg",4,100,3,"3 weeks ago",False,False),
 ("Elfball (shelved)","Lathril, Blade of the Elves","BG","BG",3,91,7,"2 months ago",False,True),
]

def deckcard(nm, cmdr, ci, art, br, ct, combos, when, cur, arch):
    ring = ('<span class="chip" style="height:22px;padding:0 7px;font-size:10.5px;border-color:var(--amber-3);'
            'background:#241a0c;color:var(--amber)">Open</span>') if cur else ""
    dim = 'opacity:.5;' if arch else ''
    tag = ('<span style="position:absolute;top:9px;left:9px;font-size:9px;letter-spacing:.09em;'
           'text-transform:uppercase;font-weight:600;background:rgba(14,13,12,.8);color:var(--ink-300);'
           'padding:3px 6px;border-radius:4px">Archived</span>') if arch else ""
    return ('<div class="deck" style="%s">'
      '<div class="deck-art" style="background:%s">%s'
        '<span style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(14,13,12,0) 38%%,rgba(14,13,12,.9))"></span>'
        '<span style="position:absolute;left:12px;right:12px;bottom:9px;display:flex;align-items:flex-end;gap:7px">'
          '<span style="flex:1;min-width:0"><span style="display:block;font-size:10px;color:var(--ink-300);'
          'overflow:hidden;white-space:nowrap;text-overflow:ellipsis">%s</span></span>%s</span>'
      '</div>'
      '<div class="deck-b"><div class="deck-nm">%s</div>'
        '<div class="deck-sub">Bracket %d &nbsp;·&nbsp; <span class="mono">%d</span> combos &nbsp;·&nbsp; %s</div>'
        '<div class="deck-ft">%s<span class="bar-mini"><i style="width:%d%%"></i></span>'
        '<span class="mono" style="font-size:10.5px;color:var(--ink-400)">%d/100</span>%s</div>'
      '</div></div>'
      % (dim, ART[art], tag, cmdr, ring, nm, br, combos, when, cipips(ci), ct, ct,
         ' <span style="color:var(--ink-500);font-size:13px;letter-spacing:1px">···</span>'))

lib_hd = ('<div style="display:flex;align-items:center;gap:12px;padding:22px 30px 18px">'
  '<span class="disp" style="font-size:21px;font-weight:600;letter-spacing:-.015em">Your decks</span>'
  '<span class="mono" style="font-size:12px;color:var(--ink-500);margin-top:3px">12</span>'
  '<span class="spacer"></span>'
  '<span class="chip" style="height:32px;width:214px;color:var(--ink-500)">%s Search decks or commanders</span>'
  '<button class="mini" style="height:32px">%s Bracket <span class="chev">▾</span></button>'
  '<button class="mini" style="height:32px">Colours <span class="chev">▾</span></button>'
  '<button class="mini" style="height:32px">Sort: Last opened <span class="chev">▾</span></button>'
  '<button class="mini" style="height:32px;background:var(--amber);color:var(--amber-ink);'
  'border-color:var(--amber);font-weight:600">%s New deck</button>'
  '</div>' % (I_SEARCH, I_FILTER, I_PLUS))

write("Library.dc.html",
  '<div style="width:1440px;height:900px;display:flex;flex-direction:column;overflow:hidden;'
  'background:var(--ink-900)">' + lib_hd +
  '<div style="padding:0 30px 30px;flex:1;overflow:hidden">'
  '<div style="display:flex;align-items:center;gap:9px;padding:0 0 13px">'
    '<span class="lbl">Active</span>'
    '<span style="flex:1;height:1px;background:var(--ink-780)"></span></div>'
  '<div class="lib">%s</div>'
  '<div style="display:flex;align-items:center;gap:9px;padding:26px 0 13px">'
    '<span class="lbl" style="color:var(--ink-500)">Archived</span>'
    '<span style="flex:1;height:1px;background:var(--ink-780)"></span></div>'
  '<div class="lib">%s</div>'
  '</div></div>'
  % ("".join(deckcard(*d) for d in DECKS[:7]), deckcard(*DECKS[7])))

# ============================ Switcher ============================
def srow(nm, sub, art, cur=False, kb=""):
    return ('<div class="srow%s"><span class="srow-art" style="background:%s"></span>'
      '<span style="flex:1;min-width:0"><span class="srow-nm">%s</span>'
      '<span class="srow-sub mono">%s</span></span>%s</div>'
      % (" cur" if cur else "", ART[art], nm, sub,
         '<span class="kbd">%s</span>' % kb if kb else ""))

write("Switcher.dc.html",
  '<div style="width:560px;height:620px;background:var(--ink-900);padding:20px;position:relative;'
  'overflow:hidden">'
  '<div style="background:var(--ink-850);border:1px solid var(--ink-700);border-radius:9px;'
  'padding:11px 13px;display:flex;align-items:center;gap:12px">'
    '<div class="cmdr" style="border-color:var(--amber-3);background:var(--ink-780)">'
    '<span class="cmdr-art"></span><span><span class="cmdr-nm">Krenko, Mob Boss</span>'
    '<span class="cmdr-sub">Goblins, all the way down</span></span>'
    '<span class="chev" style="color:var(--amber)">▾</span></div>'
    '<span class="chip">Bracket 3 <span class="chev">▾</span></span>'
    '<span class="spacer"></span>'
    '<span class="count mono">64<small>/100</small></span></div>'
  '<div class="pop" style="margin:9px 0 0 1px">'
    '<div class="pop-hd"><span class="lbl">Switch deck</span>'
      '<span class="kbd" style="margin-left:9px">⌘K</span>'
      '<span class="spacer"></span>'
      '<span style="font-size:11.5px;color:var(--amber);font-weight:600">%s New</span></div>'
    '%s%s%s%s%s'
    '<div class="pop-ft"><span style="font-size:11.5px;color:var(--ink-300)">All decks</span>'
      '<span class="mono" style="font-size:11px;color:var(--ink-500);margin-left:7px">12</span>'
      '<span class="spacer"></span><span class="chev" style="color:var(--ink-400)">→</span></div>'
  '</div>'
  '<div style="position:absolute;left:20px;right:20px;bottom:18px;font-size:10.5px;color:var(--ink-600);'
  'line-height:1.55">No confirm step and no unsaved state — every change is already saved, so switching '
  'is always safe.</div>'
  '</div>' % (I_PLUS,
    srow("Krenko, Mob Boss", "B3 · 64/100 · 14 combos", "R", cur=True, kb="⌘1"),
    srow("Atraxa, Grand Unifier", "B4 · 100/100 · 6 combos", "WUBG", kb="⌘2"),
    srow("Tymna + Thrasios", "B5 · 98/100 · 22 combos", "WUBG", kb="⌘3"),
    srow("Talrand, Sky Summoner", "B2 · 87/100 · 1 combo", "U", kb="⌘4"),
    srow("Ghave, Guru of Spores", "B4 · 100/100 · 11 combos", "GWB", kb="⌘5")))

# ============================ Mobile ============================
M_EXTRA = """
.m2 .c2{width:171px;padding:6px;border-radius:9px}
.m2 .c2-art{height:92px} .m2 .c2-nm{font-size:10.5px} .m2 .c2-tl{font-size:8.5px}
.m2 .c2-tx{height:42px} .m2 .badge{height:22px;min-width:22px;font-size:11.5px}
.m2 .row{gap:10px}
.m1 .c1{width:80px} .m1 .c1-art{height:48px} .m1 .row{gap:9px}
.swipeaff{position:absolute;top:0;bottom:0;width:52px;display:grid;place-items:center;border-radius:9px}
.tap{height:46px;border-radius:9px;display:flex;align-items:center;justify-content:center;gap:7px;
  font-size:13px;font-weight:600}
"""

def mbar(count=64):
    return ('<div class="ph-bar">'
      '<div class="ph-r1">'
        '<div class="cmdr" style="flex:1;min-width:0;padding:4px 9px 4px 4px">'
          '<span class="cmdr-art" style="width:34px;height:34px"></span>'
          '<span style="flex:1;min-width:0"><span class="cmdr-nm" style="font-size:13px">Krenko, Mob Boss</span>'
          '<span class="cmdr-sub">Bracket 3</span></span><span class="chev">▾</span></div>'
        '<span class="count mono" style="font-size:17px">%d<small>/100</small></span>'
      '</div>'
      '<div class="ph-r2">%s%s%s%s</div></div>'
      % (count,
         '<div class="ph-m">' + meter("Lands", 34, 36, "short") + '</div>',
         '<div class="ph-m">' + meter("Ramp", 8, 11, "short") + '</div>',
         '<div class="ph-m">' + meter("Draw", 6, 9, "short") + '</div>',
         '<div class="ph-m">' + meter("Inter", 5, 8, "short") + '</div>'))

feed = ('<div class="m2" style="padding:0 14px 14px">'
  '<div class="grp" style="margin-top:12px">' +
  grp("Completes 3+ combos", 6, "Finishes three or more combos using cards already in your deck.", "var(--amber)") +
  '<div class="row">' +
    c2("Kiki-Jiki, Mirror Breaker","2RRR","Legendary Creature — Goblin","R3",deg=3,flag=True) +
    c2("Thornbite Staff","2","Artifact — Equipment","C2",deg=3) +
  '</div></div>'
  '<div class="grp">' + grp("Completes 2 combos", 14, "", "var(--amber-2)") +
  '<div class="row">' +
    c2("Combat Celebrant","2R","Creature — Human","R",deg=2) +
    c2("Goblin Sharpshooter","2R","Creature — Goblin","R2",deg=2) +
  '</div></div>'
  '<div class="grp">' + grp("Fills gap · Ramp −3", 22, "", "var(--warn)") +
  '<div class="row">' + c2("Mind Stone","2","Artifact","C") + c2("Thran Dynamo","4","Artifact","C2") +
  '</div></div></div>')

# --- peek detent ---
write("MobilePeek.dc.html",
  '<div class="ph">' + mbar() +
  '<div style="flex:1;overflow:hidden">%s</div>'
  '<div class="sheet" style="background:#1c1a19"><div class="grab"></div>'
    '<div class="sheet-hd" style="padding-bottom:26px">'
      '<span class="lbl">Deck</span>'
      '<span class="mono" style="font-size:14px;font-weight:600">64<span style="color:var(--ink-500);'
      'font-size:11px">/100</span></span>'
      '<span class="spacer"></span>'
      '<span class="chip warnish" style="height:24px;font-size:10.5px;padding:0 8px">%s Lands −2</span>'
      '<span class="chev" style="font-size:11px">▴</span></div></div>'
  '</div>' % (feed, I_WARN), css_extra=M_EXTRA)

# --- half detent ---
deck_half = ('<div class="m1" style="padding:0 15px 15px;overflow:hidden">'
  '<div class="grp" style="margin-top:4px">' + grp("Core · Bracket 3", 24, dotc="var(--amber-3)") +
  '<div class="row">' + c1("Sol Ring","C") + c1("Arcane Signet","C2") + c1("Commander's Sphere","C") +
  c1("Jeska's Will","R2") + '</div></div>'
  '<div class="grp">' + grp("Win conditions", 4) + '<div class="row">' +
  c1("Purphoros, God of the Forge","R3") + c1("Goblin Bombardment","R2") +
  c1("Zealous Conscripts","R") + c1("Skirk Prospector","R2") + '</div></div>'
  '<div class="grp">' + grp("Ramp", 8, open_=False) + '</div>'
  '<div class="grp">' + grp("Lands", 34, open_=False) + '</div>')

write("MobileHalf.dc.html",
  '<div class="ph">' + mbar() +
  '<div style="flex:1;overflow:hidden">%s</div>'
  '<div class="sheet" style="background:#1c1a19;height:432px"><div class="grab"></div>'
    '<div class="sheet-hd">'
      '<span class="lbl">Deck</span>'
      '<span class="mono" style="font-size:14px;font-weight:600">64<span style="color:var(--ink-500);'
      'font-size:11px">/100</span></span>'
      '<span class="spacer"></span>'
      '<button class="mini">Group: Role <span class="chev">▾</span></button>'
      '<span class="chev" style="font-size:11px">▾</span></div>'
    '%s</div></div>' % (feed, deck_half), css_extra=M_EXTRA)

# --- inspect sheet + swipe affordances ---
swipe_demo = ('<div class="m2" style="padding:0 14px 14px">'
  '<div class="grp" style="margin-top:12px">' + grp("Completes 3+ combos", 6, "", "var(--amber)") +
  '<div style="position:relative;margin-top:11px;height:196px">'
    '<div class="swipeaff" style="left:0;width:76px;background:linear-gradient(90deg,#1e3018,#1e301800);'
    'color:var(--good)">%s</div>'
    '<div class="swipeaff" style="right:0;width:76px;background:linear-gradient(270deg,#301a18,#301a1800);'
    'color:var(--danger)">%s</div>'
    '<div style="position:absolute;left:52px;top:0"><div class="row">%s</div></div>'
    '<div style="position:absolute;left:0;bottom:2px;right:0;display:flex;justify-content:space-between;'
    'font-size:9.5px;color:var(--ink-500)"><span>← swipe to add</span><span>swipe to dismiss →</span></div>'
  '</div></div></div>' % (I_CHECK, I_X,
    c2("Thornbite Staff","2","Artifact — Equipment","C2",deg=3)))

insp_m = ('<div style="padding:0 16px 16px;overflow:hidden">'
  '<div style="display:flex;gap:13px">'
    '<div class="c2" style="width:118px;flex:none"><span class="badge">3</span>'
      '<div class="c2-hd"><span class="c2-nm" style="font-size:8.5px">Kiki-Jiki, Mirror Breaker</span></div>'
      '<div class="c2-art" style="height:62px;background:%s"></div>'
      '<div class="c2-tl" style="font-size:7px">Legendary Creature</div>'
      '<div class="c2-tx" style="height:32px"><i style="width:96%%"></i><i style="width:74%%"></i>'
      '<i style="width:88%%"></i></div></div>'
    '<div style="flex:1;min-width:0">'
      '<div class="disp" style="font-size:15px;font-weight:600;line-height:1.2">Kiki-Jiki, Mirror Breaker</div>'
      '<div style="display:flex;gap:3px;margin-top:7px">%s</div>'
      '<div class="stat" style="margin:11px 0 0;gap:11px">'
        '<div><span class="lbl" style="font-size:8.5px">Incl.</span><div class="v mono" style="font-size:14px">61%%</div></div>'
        '<div><span class="lbl" style="font-size:8.5px">Syn.</span><div class="v mono" style="font-size:14px;color:var(--good)">+0.44</div></div>'
        '<div><span class="lbl" style="font-size:8.5px">Price</span><div class="v mono" style="font-size:14px">$18</div></div>'
      '</div></div></div>'
  '<div style="margin-top:14px">%s%s</div></div>'
  % (ART["R3"], pips("2RRR"),
     reason(I_LINK, "#3a2a10", "var(--amber)",
       'Completes <b>3 combos</b> with cards you have accepted', combo_lines),
     reason(I_WARN, "#33240c", "var(--warn)",
       '<b>Game Changer.</b> Bracket 3 allows 3; you have 3.')))

write("MobileInspect.dc.html",
  '<div class="ph">' + mbar() +
  '<div style="flex:1;overflow:hidden">%s</div>'
  '<div class="sheet" style="background:#1c1a19;height:566px"><div class="grab"></div>'
    '<div class="sheet-hd"><span class="lbl">Inspect</span><span class="spacer"></span>'
    '<span style="color:var(--ink-400)">%s</span></div>'
    '%s'
    '<div style="margin-top:auto;display:flex;gap:9px;padding:12px 16px 26px;'
    'border-top:1px solid var(--ink-750)">'
      '<span class="tap" style="flex:1;background:var(--amber);color:var(--amber-ink)">%s Add to deck</span>'
      '<span class="tap" style="flex:1;border:1px solid var(--ink-650);color:var(--ink-300)">Not for this deck</span>'
    '</div></div></div>' % (swipe_demo, I_X, insp_m, I_CHECK), css_extra=M_EXTRA)

# ============================ query bar ============================
Q_EXTRA = """
.qbar{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:7px;
  border:1px solid var(--ink-650);background:var(--ink-800);min-height:34px}
.qbar.on{border-color:var(--amber-3);background:#171512}
.qchip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 5px 0 7px;border-radius:5px;
  background:var(--ink-700);border:1px solid var(--ink-600);font-size:11px;color:var(--ink-200);
  font-family:'IBM Plex Mono',monospace;white-space:nowrap}
.qchip b{color:var(--amber);font-weight:500}
.qchip .x{color:var(--ink-500);font-size:11px;margin-left:1px}
.qchip.dg{border-color:var(--amber-3);background:#2a1f0e}
.qin{font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:var(--ink-300);flex:1;min-width:60px}
.qin.ph{color:var(--ink-600)}
.caret-bar{display:inline-block;width:1px;height:13px;background:var(--amber);
  vertical-align:-2px;margin-left:1px}
.qtog{all:unset;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink-500);
  border:1px solid var(--ink-650);border-radius:4px;padding:2px 5px;cursor:pointer}
.qmatch{font-size:11px;color:var(--ink-400)}
.qmatch b{color:var(--ink-100);font-weight:600}
.ac{position:absolute;z-index:9;width:392px;border-radius:8px;border:1px solid var(--ink-650);
  background:var(--ink-780);box-shadow:0 16px 40px rgba(0,0,0,.7);overflow:hidden}
.ac-s{padding:7px 11px 6px;border-bottom:1px solid var(--ink-700);display:flex;align-items:center;gap:8px}
.ac-r{display:flex;align-items:center;gap:9px;padding:7px 11px;font-size:11.5px}
.ac-r.sel{background:var(--ink-700)}
.ac-k{font-family:'IBM Plex Mono',monospace;color:var(--amber);flex:none}
.ac-h{color:var(--ink-500);font-size:10.5px}
.ac-n{margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--ink-500)}
.withheld{display:flex;align-items:center;gap:6px;margin-top:9px;padding:6px 8px;border-radius:6px;
  border:1px dashed var(--ink-650);font-size:10.5px;color:var(--ink-500)}
.withheld em{font-style:normal;color:var(--ink-300)}
.withheld a{margin-left:auto;font-size:10.5px}
"""

def qbar(active=False, extra=""):
    if not active:
        return ('<div class="qbar"><span style="color:var(--ink-600)">%s</span>'
                '<span class="qin ph">Filter candidates &nbsp;·&nbsp; t:instant mv&lt;=2 combo&gt;=2</span>'
                '<button class="qtog">&lt;/&gt;</button></div>' % I_SEARCH)
    return ('<div class="qbar on"><span style="color:var(--amber-3)">%s</span>'
      '<span class="qchip">t:<b>creature</b><span class="x">✕</span></span>'
      '<span class="qchip">mv<b>&le;3</b><span class="x">✕</span></span>'
      '<span class="qchip dg">combo<b>&ge;2</b><span class="x">✕</span></span>'
      '<span class="qin">o:"treas<span class="caret-bar"></span></span>'
      '<button class="qtog">&lt;/&gt;</button></div>%s' % (I_SEARCH, extra))

def cand_hd(active=False, matched=None, total=248):
    right = ('<span class="qmatch"><b class="mono">%d</b> of <span class="mono">%d</span> match</span>'
             '<button class="mini">Clear</button>' % (matched, total)) if active else (
             '<span class="mono" style="font-size:11px;color:var(--ink-500)">%d</span>' % total)
    return ('<div style="padding:11px 16px 10px;border-bottom:1px solid var(--ink-780)">'
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
        '<span class="lbl">Candidates</span>%s<span class="spacer"></span>'
        '<button class="mini">%s Weights</button></div>%s</div>'
      % (right, I_CHART, qbar(active)))

def withheld(n, what):
    return ('<div class="withheld">%s<span><em>+%d more</em> %s but don\'t match your filter</span>'
            '<a>show</a></div>' % (I_WARN, n, what))

# --- re-emit the three desktop workspace artboards with the query bar ---
CSSX = Q_EXTRA
write("Main.dc.html",
  '<div style="width:1440px;height:900px;display:flex;flex-direction:column;overflow:hidden">'
  + cmdbar(2) +
  '<div class="work">'
    '<div class="pane" style="width:46%%">%s<div class="pane-body">%s</div></div>'
    '<div class="vdiv"></div>'
    '<div class="pane" style="flex:1">%s<div class="pane-body">%s</div></div>'
  '</div></div>' % (accepted_hd(), acc2, cand_hd(), can2), css_extra=CSSX)

write("ZoomGrid.dc.html",
  '<div style="width:1440px;height:900px;display:flex;flex-direction:column;overflow:hidden">'
  + cmdbar(1) +
  '<div class="work">'
    '<div class="pane" style="width:46%%">%s<div class="pane-body">%s</div></div>'
    '<div class="vdiv"></div>'
    '<div class="pane" style="flex:1">%s<div class="pane-body">%s</div></div>'
  '</div></div>' % (accepted_hd(), accG, cand_hd(), canG), css_extra=CSSX)

write("Inspect.dc.html",
  '<div style="width:1440px;height:900px;display:flex;flex-direction:column;overflow:hidden">'
  + cmdbar(1) +
  '<div class="work">'
    '<div class="pane" style="width:330px;flex:none">%s<div class="pane-body">%s</div></div>'
    '<div class="vdiv"></div>'
    '<div class="pane" style="flex:1">%s<div class="pane-body">%s</div></div>'
    '%s'
  '</div></div>' % (accepted_hd(), acc_narrow, cand_hd(), can_narrow, insp_panel),
  css_extra=INSP_EXTRA + CSSX)

# ============================ Filter — desktop active query ============================
ac = ('<div class="ac" style="left:322px;top:74px">'
  '<div class="ac-s"><span class="ac-k">o:</span>'
    '<span style="font-size:11.5px;color:var(--ink-200)">oracle text contains</span>'
    '<span class="ac-n">field</span></div>'
  '<div class="ac-r sel"><span class="ac-k">o:"create a treasure token"</span>'
    '<span class="ac-n">1,204</span></div>'
  '<div class="ac-r"><span class="ac-k">o:"treasure"</span>'
    '<span class="ac-n">1,891</span></div>'
  '<div class="ac-r"><span class="ac-k">o:"treasure token"</span>'
    '<span class="ac-n">1,187</span></div>'
  '<div class="ac-r" style="border-top:1px solid var(--ink-700)">'
    '<span class="ac-k">t:treasure</span><span class="ac-h">token type</span>'
    '<span class="ac-n">3</span></div>'
  '<div style="padding:7px 11px;border-top:1px solid var(--ink-700);font-size:10px;color:var(--ink-600)">'
    'Counts are matches in the whole card pool, before your other filters.</div>'
  '</div>')

canF = ('<div class="grp">' + grp("Completes 3+ combos", 1, "", "var(--amber)") +
  '<div class="row">' + c2("Goblin Welder","R","Creature — Goblin Artificer","R",deg=3) + '</div>' +
  withheld(5, "complete 3+ combos") + '</div>'
  '<div class="grp">' + grp("Completes 2 combos", 6, "", "var(--amber-2)") +
  '<div class="row">' +
    c2("Goblin Sharpshooter","2R","Creature — Goblin","R2",deg=2) +
    c2("Combat Celebrant","2R","Creature — Human Warrior","R",deg=2) +
    c2("Pashalik Mons","2R","Legendary Creature — Goblin","R3",deg=2) +
  '</div>' + withheld(8, "complete 2 combos") + '</div>'
  '<div class="grp">' + grp("Completes 1 combo", 12, "", "var(--amber-3)") +
  '<div class="row">' +
    c2("Mogg Fanatic","R","Creature — Goblin","R2",deg=1) +
    c2("Goblin Piledriver","1R","Creature — Goblin Warrior","R3",deg=1) +
    c2("Goblin Instigator","1R","Creature — Goblin","R",deg=1) +
  '</div></div>'
  '<div class="grp">' + grp("High synergy", 15, "", open_=False) + '</div>'
  '<div class="grp" style="margin-top:14px">'
  '<div class="withheld" style="border-style:solid;border-color:var(--ink-700)">%s'
  '<span><em>214 candidates</em> are hidden by this filter across 5 groups</span>'
  '<a>clear filter</a></div></div>' % I_FILTER)

acc_dim = ('<div class="grp">' + grp("Core · Bracket 3", 24, dotc="var(--amber-3)") +
  '<div class="row" style="opacity:.38">' + c1("Sol Ring","C") + c1("Arcane Signet","C2") +
  c1("Commander\'s Sphere","C") + c1("Jeska\'s Will","R2") + c1("Deflecting Swat","R3") +
  c1("Chaos Warp","R") + '</div></div>'
  '<div class="grp">' + grp("Win conditions", 4) + '<div class="row">' +
  '<span style="opacity:.38">' + c1("Purphoros, God of the Forge","R3") + '</span>' +
  '<span style="opacity:.38">' + c1("Goblin Bombardment","R2") + '</span>' +
  c1("Zealous Conscripts","R") + c1("Skirk Prospector","R2") + '</div>'
  '<div style="font-size:10px;color:var(--ink-600);margin-top:8px;line-height:1.5">'
  'Accepted cards dim when they don\'t match — never hidden. You still own them.</div></div>'
  '<div class="grp">' + grp("Ramp", 8, open_=False) + '</div>'
  '<div class="grp">' + grp("Lands", 34, open_=False) + '</div>')

write("Filter.dc.html",
  '<div style="width:1440px;height:900px;display:flex;flex-direction:column;overflow:hidden">'
  + cmdbar(2) +
  '<div class="work">'
    '<div class="pane" style="width:330px;flex:none">%s<div class="pane-body">%s</div></div>'
    '<div class="vdiv"></div>'
    '<div class="pane" style="flex:1;position:relative">%s%s<div class="pane-body">%s</div></div>'
  '</div></div>' % (accepted_hd(), acc_dim, cand_hd(True, 34), ac, canF), css_extra=Q_EXTRA)

# ============================ MobileFilter — faceted sheet ============================
F_EXTRA = """
.fsec{padding:15px 16px;border-bottom:1px solid var(--ink-780)}
.fsec-hd{display:flex;align-items:center;gap:8px;margin-bottom:11px}
.fchips{display:flex;flex-wrap:wrap;gap:7px}
.fc{height:34px;padding:0 12px;border-radius:17px;border:1px solid var(--ink-650);
  background:var(--ink-800);font-size:12.5px;color:var(--ink-300);display:inline-flex;align-items:center;gap:6px}
.fc.on{background:var(--amber);border-color:var(--amber);color:var(--amber-ink);font-weight:600}
.rng{position:relative;height:34px;display:flex;align-items:center}
.rng-t{height:4px;border-radius:2px;background:var(--ink-700);width:100%}
.rng-f{position:absolute;height:4px;border-radius:2px;background:var(--amber-3)}
.rng-h{position:absolute;width:22px;height:22px;border-radius:50%;background:var(--ink-200);
  border:2px solid var(--ink-900);box-shadow:0 2px 6px rgba(0,0,0,.6)}
.step{display:flex;align-items:center;gap:0;border:1px solid var(--ink-650);border-radius:8px;overflow:hidden}
.step span{width:44px;height:44px;display:grid;place-items:center;color:var(--ink-300);font-size:16px}
.step b{width:52px;height:44px;display:grid;place-items:center;font-family:'IBM Plex Mono',monospace;
  font-size:15px;font-weight:600;border-left:1px solid var(--ink-700);border-right:1px solid var(--ink-700)}
.mpip{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;
  border:2px solid var(--ink-650);opacity:.45}
.mpip.on{opacity:1;border-color:var(--amber)}
.tog{width:44px;height:26px;border-radius:13px;background:var(--ink-700);position:relative;flex:none}
.tog i{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:var(--ink-400)}
.tog.on{background:var(--amber-3)} .tog.on i{left:21px;background:var(--amber)}
.frow{display:flex;align-items:center;gap:12px;padding:9px 0}
.frow-t{font-size:12.5px;color:var(--ink-200)}
"""

def fchips(items):
    return '<div class="fchips">' + "".join(
      '<span class="fc%s">%s%s</span>' % (" on" if on else "", nm, ' <span style="opacity:.6">✕</span>' if on else "")
      for nm, on in items) + '</div>'

def fsec(title, body, sub=""):
    return ('<div class="fsec"><div class="fsec-hd"><span class="lbl">%s</span>%s'
            '<span class="spacer"></span><span class="chev">▾</span></div>%s</div>'
            % (title, '<span style="font-size:10.5px;color:var(--ink-500)">%s</span>' % sub if sub else "", body))

mf_body = (
  fsec("Name or text",
    '<div class="chip" style="height:44px;width:100%%;border-radius:9px;color:var(--ink-500);font-size:13px">'
    '%s Search name and oracle text</div>' % I_SEARCH) +
  fsec("Card type", fchips([("Creature",True),("Instant",False),("Sorcery",False),
    ("Artifact",False),("Enchantment",False),("Land",False)])) +
  fsec("Mana value", '<div class="rng"><span class="rng-t"></span>'
    '<span class="rng-f" style="left:0;width:34%"></span>'
    '<span class="rng-h" style="left:-2px"></span><span class="rng-h" style="left:32%"></span></div>'
    '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-400)" class="mono">'
    '<span>0</span><span style="color:var(--ink-100);font-weight:600">0 – 3</span><span>12+</span></div>',
    "mv ≤ 3") +
  fsec("Colours",
    '<div style="display:flex;gap:9px">' + "".join(
      '<span class="mpip%s" style="background:%s"></span>' % (" on" if c == "R" else "", CI[c])
      for c in "WUBRG") +
    '<span class="spacer"></span><button class="mini" style="height:44px;padding:0 12px">'
    'Subset <span class="chev">▾</span></button></div>') +
  fsec("Combo degree",
    '<div style="display:flex;align-items:center;gap:13px">'
    '<div class="step"><span>−</span><b>2</b><span>+</span></div>'
    '<span style="font-size:12px;color:var(--ink-300);line-height:1.4">completes at least '
    '<b style="color:var(--amber)">2</b> combos with cards you have accepted</span></div>',
    "combo ≥ 2") +
  fsec("Role", fchips([("Ramp",False),("Draw",False),("Removal",False),("Wincon",False),
    ("Protection",False),("Tutor",False)])) +
  fsec("Flags",
    '<div class="frow"><span class="frow-t">Hide Game Changers</span><span class="spacer"></span>'
    '<span class="tog on"><i></i></span></div>'
    '<div class="frow"><span class="frow-t">Hide two-card infinites</span><span class="spacer"></span>'
    '<span class="tog"><i></i></span></div>'
    '<div class="frow"><span class="frow-t">Hide reserved list</span><span class="spacer"></span>'
    '<span class="tog"><i></i></span></div>') +
  fsec("Advanced",
    '<div class="chip" style="height:44px;width:100%;border-radius:9px;font-size:11.5px;'
    'font-family:\'IBM Plex Mono\',monospace;color:var(--ink-300);border-color:var(--amber-3)">'
    't:creature mv&lt;=3 combo&gt;=2</div>'
    '<div style="font-size:10.5px;color:var(--ink-600);margin-top:8px;line-height:1.5">'
    'The facets above and this field are the same query. Editing either updates the other.</div>'))

write("MobileFilter.dc.html",
  '<div class="ph">'
  '<div style="padding:52px 16px 0;background:var(--ink-850);border-bottom:1px solid var(--ink-700)">'
    '<div style="display:flex;align-items:center;gap:12px;padding-bottom:13px">'
      '<span class="disp" style="font-size:16px;font-weight:600">Filter candidates</span>'
      '<span class="spacer"></span>'
      '<span style="font-size:12.5px;color:var(--amber);font-weight:600">Reset</span>'
      '<span style="color:var(--ink-400);margin-left:4px">%s</span></div></div>'
  '<div style="flex:1;overflow:hidden">%s</div>'
  '<div style="padding:12px 16px 26px;border-top:1px solid var(--ink-700);background:var(--ink-850)">'
    '<span class="tap" style="background:var(--amber);color:var(--amber-ink)">Show 34 cards</span>'
    '<div style="text-align:center;font-size:10.5px;color:var(--ink-500);margin-top:9px">'
    '214 of 248 candidates hidden by this filter</div></div>'
  '</div>' % (I_X, mf_body), css_extra=M_EXTRA + F_EXTRA)

# ============================ archetype in the command bar ============================
def cmdbar(zoom=2, count=64):
    return ('<div class="bar">'
      '<div class="bar-r1">'
        '<div class="cmdr"><span class="cmdr-art"></span><span>'
          '<span class="cmdr-nm">Krenko, Mob Boss</span>'
          '<span class="cmdr-sub">Goblins, all the way down</span></span>'
          '<span class="chev">▾</span></div>'
        '<span class="chip">Tokens <span class="chev">▾</span></span>'
        '<span class="chip">Bracket 3 <span class="chev">▾</span></span>'
        '<span class="chip warnish">%s 4/3 Game Changers</span>'
        '<span class="spacer"></span>'
        '<span class="chip" style="border:0;background:transparent;padding:0 4px">'
          '<span class="lbl">Combos</span><span class="mono" style="font-size:14px;font-weight:600;color:var(--amber)">14</span></span>'
        '<span class="count mono">%d<small>/100</small></span>'
        '%s'
      '</div>'
      '<div class="bar-r2">'
        '%s%s%s%s<span class="mdiv"></span>%s%s'
        '<span class="spacer"></span>'
        '<span class="lbl" style="color:var(--ink-500)">avg MV <span class="mono" style="color:var(--ink-300)">2.94</span></span>'
      '</div></div>'
      % (I_WARN, count, zoomctl(zoom),
         meter("Lands", 34, 35, "short"), meter("Ramp", 8, 10, "short"),
         meter("Draw", 6, 9, "short"), meter("Interaction", 5, 7, "short"),
         meter("Token makers", 9, 14, "short"), meter("Creatures", 22, 24, "short")))

def mbar(count=64):
    return ('<div class="ph-bar">'
      '<div class="ph-r1">'
        '<div class="cmdr" style="flex:1;min-width:0;padding:4px 9px 4px 4px">'
          '<span class="cmdr-art" style="width:34px;height:34px"></span>'
          '<span style="flex:1;min-width:0"><span class="cmdr-nm" style="font-size:13px">Krenko, Mob Boss</span>'
          '<span class="cmdr-sub">Tokens · Bracket 3</span></span><span class="chev">▾</span></div>'
        '<span class="count mono" style="font-size:17px">%d<small>/100</small></span>'
      '</div>'
      '<div class="ph-r2">%s%s%s%s</div></div>'
      % (count,
         '<div class="ph-m">' + meter("Lands", 34, 35, "short") + '</div>',
         '<div class="ph-m">' + meter("Ramp", 8, 10, "short") + '</div>',
         '<div class="ph-m">' + meter("Tokens", 9, 14, "short") + '</div>',
         '<div class="ph-m">' + meter("Creat.", 22, 24, "short") + '</div>'))

# ============================ NewDeck — creation flow, archetype step ============================
A_EXTRA = """
.steps{display:flex;align-items:center;gap:0}
.stp{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-500)}
.stp b{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:11px;
  font-family:'IBM Plex Mono',monospace;border:1px solid var(--ink-650);font-weight:500}
.stp.done{color:var(--ink-300)} .stp.done b{background:var(--ink-700);border-color:var(--ink-600);color:var(--good)}
.stp.now{color:var(--ink-100)} .stp.now b{background:var(--amber);border-color:var(--amber);color:var(--amber-ink);font-weight:600}
.stp-l{width:34px;height:1px;background:var(--ink-700);margin:0 13px}
.agrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.ac2{border:1px solid var(--ink-650);background:var(--ink-800);border-radius:10px;padding:15px 16px 14px;
  position:relative}
.ac2.sel{border-color:var(--amber);background:#1d1913;box-shadow:0 0 0 1px var(--amber)}
.ac2-nm{font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:600;letter-spacing:-.01em}
.ac2-pl{font-size:11.5px;color:var(--ink-400);line-height:1.5;margin-top:5px;height:34px}
.ac2-n{display:flex;gap:13px;margin-top:12px;padding-top:11px;border-top:1px solid var(--ink-750)}
.ac2-n div{font-size:10px;color:var(--ink-500)}
.ac2-n b{display:block;font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;
  color:var(--ink-200);margin-top:2px}
.ac2-n b.up{color:var(--good)} .ac2-n b.dn{color:var(--warn)}
.pick{position:absolute;top:13px;right:14px;width:19px;height:19px;border-radius:50%;
  background:var(--amber);color:var(--amber-ink);display:grid;place-items:center}
.share{position:absolute;top:15px;right:16px;font-family:'IBM Plex Mono',monospace;font-size:11px;
  color:var(--ink-500)}
.vec{display:flex;gap:0;border:1px solid var(--ink-700);border-radius:8px;overflow:hidden}
.vec div{flex:1;padding:10px 12px;border-right:1px solid var(--ink-780)}
.vec div:last-child{border-right:0}
.vec b{display:block;font-family:'IBM Plex Mono',monospace;font-size:15px;font-weight:600;margin-top:3px}
.vec .d{font-size:9.5px;margin-top:2px}
"""

ARCH = [
 ("Aggro","Deploy threats early, attack, close before the table stabilises",
  [("lands","34","dn"),("creatures","32","up"),("wipes","1","dn")],False,"31%"),
 ("Midrange","Efficient threats and answers; win by out-valuing everyone",
  [("lands","36",""),("creatures","26",""),("draw","9","")],False,""),
 ("Control","Answer everything, draw more, win late with few threats",
  [("draw","12","up"),("removal","12","up"),("creatures","14","dn")],False,""),
 ("Combo","Assemble a specific interaction, protect it, win from it",
  [("tutors","8","up"),("ramp","13","up"),("wipes","1","dn")],False,"9%"),
 ("Ramp / Big mana","Accelerate hard, cast things nobody else can",
  [("ramp","17","up"),("lands","38","up"),("removal","6","dn")],False,""),
 ("Aristocrats","Sacrifice your own creatures for value and reach",
  [("sac outlets","5","up"),("recursion","7","up"),("creatures","30","up")],False,""),
 ("Voltron","Make one creature enormous and unanswerable",
  [("protection","10","up"),("equipment","8","up"),("creatures","12","dn")],False,""),
 ("Tokens / Go-wide","Flood the board, then make the board lethal",
  [("token makers","14","up"),("anthems","6","up"),("creatures","24","")],True,"54%"),
 ("Stax / Prison","Deny resources and win slowly under a locked table",
  [("stax pieces","12","up"),("ramp","12","up"),("creatures","16","dn")],False,""),
]

def acard(nm, plan, nums, sel, share):
    n = "".join('<div>%s<b class="%s">%s</b></div>' % (l, c, v) for l, v, c in nums)
    mark = ('<span class="pick">%s</span>' % I_CHECK) if sel else (
           ('<span class="share">%s</span>' % share) if share else "")
    return ('<div class="ac2%s">%s<div class="ac2-nm">%s</div><div class="ac2-pl">%s</div>'
            '<div class="ac2-n">%s</div></div>' % (" sel" if sel else "", mark, nm, plan, n))

steps = ('<div class="steps">'
  '<span class="stp done"><b>%s</b>Commander</span><span class="stp-l"></span>'
  '<span class="stp now"><b>2</b>Archetype</span><span class="stp-l"></span>'
  '<span class="stp"><b>3</b>Bracket</span><span class="stp-l"></span>'
  '<span class="stp"><b>4</b>Core cards</span></div>' % I_CHECK)

vec = ('<div class="vec">' + "".join(
  '<div><span class="lbl">%s</span><b>%s</b><span class="d" style="color:%s">%s</span></div>'
  % (l, v, c, d) for l, v, d, c in [
    ("Lands","35","−1 vs midrange","var(--warn)"),("Ramp","10","−1","var(--warn)"),
    ("Draw","9","same","var(--ink-600)"),("Removal","7","−1","var(--warn)"),
    ("Wipes","2","−1","var(--warn)"),("Creatures","24","−2","var(--warn)"),
    ("Token makers","14","new","var(--good)"),("Anthems","6","new","var(--good)")]) + '</div>')

write("NewDeck.dc.html",
  '<div style="width:1440px;height:900px;display:flex;flex-direction:column;overflow:hidden;'
  'background:var(--ink-900)">'
  '<div style="padding:22px 40px 18px;border-bottom:1px solid var(--ink-780);display:flex;'
  'align-items:center;gap:20px">'
    '<span class="disp" style="font-size:19px;font-weight:600;letter-spacing:-.015em">New deck</span>'
    '<span class="spacer"></span>%s<span class="spacer"></span>'
    '<span style="color:var(--ink-500)">%s</span></div>'
  '<div style="padding:20px 40px 0;display:flex;align-items:center;gap:13px">'
    '<span class="cmdr-art" style="width:44px;height:44px;border-radius:6px"></span>'
    '<span><span class="cmdr-nm" style="font-size:15px">Krenko, Mob Boss</span>'
    '<span class="cmdr-sub">Mono-red · legendary creature</span></span>'
    '<span class="chip" style="margin-left:6px">Change</span>'
    '<span class="spacer"></span>'
    '<span style="font-size:12px;color:var(--ink-400);text-align:right;line-height:1.55">'
    '<b style="color:var(--ink-100);font-weight:600">Tokens</b> — 54%% of Krenko decks build this way<br>'
    '<span style="color:var(--ink-500)">Also common: Aggro 31%% · Combo 9%% &nbsp;·&nbsp; source: EDHREC</span></span>'
  '</div>'
  '<div style="padding:20px 40px 0;flex:1;overflow:hidden">'
    '<div class="agrid">%s</div>'
    '<div style="margin-top:22px;display:flex;align-items:center;gap:10px">'
      '<span class="lbl">Targets this sets</span>'
      '<span style="font-size:11px;color:var(--ink-500)">Tokens / Go-wide, before bracket and curve adjustments</span>'
      '<span class="spacer"></span>'
      '<span style="font-size:11px;color:var(--ink-500)">Changeable at any time — it moves targets, never cards</span></div>'
    '<div style="margin-top:9px">%s</div>'
  '</div>'
  '<div style="padding:16px 40px 20px;border-top:1px solid var(--ink-780);display:flex;'
  'align-items:center;gap:11px">'
    '<button class="mini" style="height:38px;padding:0 16px">Back</button>'
    '<span class="spacer"></span>'
    '<span style="font-size:11.5px;color:var(--ink-500)">Step 2 of 4</span>'
    '<button class="mini" style="height:38px;padding:0 20px;background:var(--amber);'
    'color:var(--amber-ink);border-color:var(--amber);font-weight:600;font-size:12.5px">Continue</button>'
  '</div></div>'
  % (steps, I_X, "".join(acard(*a) for a in ARCH), vec),
  css_extra=A_EXTRA)

# ============ re-emit everything that embeds the command bar ============
def desk(name, zoom, ahd, abody, chd, cbody, extra_pane="", accw="46%", cssx=Q_EXTRA):
    write(name,
      '<div style="width:1440px;height:900px;display:flex;flex-direction:column;overflow:hidden">'
      + cmdbar(zoom) +
      '<div class="work">'
        '<div class="pane" style="width:%s;%s">%s<div class="pane-body">%s</div></div>'
        '<div class="vdiv"></div>'
        '<div class="pane" style="flex:1;position:relative">%s<div class="pane-body">%s</div></div>'
        '%s'
      '</div></div>' % (accw, "flex:none" if accw.endswith("px") else "", ahd, abody, chd, cbody, extra_pane),
      css_extra=cssx)

desk("Main.dc.html", 2, accepted_hd(), acc2, cand_hd(), can2)
desk("ZoomGrid.dc.html", 1, accepted_hd(), accG, cand_hd(), canG)
desk("Inspect.dc.html", 1, accepted_hd(), acc_narrow, cand_hd(), can_narrow,
     extra_pane=insp_panel, accw="330px", cssx=INSP_EXTRA + Q_EXTRA)
desk("Filter.dc.html", 2, accepted_hd(), acc_dim, cand_hd(True, 34) + ac, canF, accw="330px")

write("ZoomConstellation.dc.html",
  '<div style="width:1440px;height:900px;display:flex;flex-direction:column;overflow:hidden">'
  + cmdbar(0) +
  '<div class="work">'
    '<div class="pane" style="width:38%%">%s<div class="pane-body" style="padding-top:2px">%s</div></div>'
    '<div class="vdiv"></div>'
    '<div class="pane" style="flex:1">%s<div class="pane-body" style="padding-top:2px">%s</div></div>'
  '</div></div>' % (accepted_hd(), l0pane("accepted"), l0_cand_hd, l0pane("candidates")),
  css_extra=L0_EXTRA, script=L0_SCRIPT)

write("MobilePeek.dc.html",
  '<div class="ph">' + mbar() +
  '<div style="flex:1;overflow:hidden">%s</div>'
  '<div class="sheet" style="background:#1c1a19"><div class="grab"></div>'
    '<div class="sheet-hd" style="padding-bottom:26px"><span class="lbl">Deck</span>'
      '<span class="mono" style="font-size:14px;font-weight:600">64<span style="color:var(--ink-500);'
      'font-size:11px">/100</span></span><span class="spacer"></span>'
      '<span class="chip warnish" style="height:24px;font-size:10.5px;padding:0 8px">%s Token makers −5</span>'
      '<span class="chev" style="font-size:11px">▴</span></div></div>'
  '</div>' % (feed, I_WARN), css_extra=M_EXTRA)

write("MobileHalf.dc.html",
  '<div class="ph">' + mbar() +
  '<div style="flex:1;overflow:hidden">%s</div>'
  '<div class="sheet" style="background:#1c1a19;height:432px"><div class="grab"></div>'
    '<div class="sheet-hd"><span class="lbl">Deck</span>'
      '<span class="mono" style="font-size:14px;font-weight:600">64<span style="color:var(--ink-500);'
      'font-size:11px">/100</span></span><span class="spacer"></span>'
      '<button class="mini">Group: Role <span class="chev">▾</span></button>'
      '<span class="chev" style="font-size:11px">▾</span></div>%s</div></div>'
  % (feed, deck_half), css_extra=M_EXTRA)

write("MobileInspect.dc.html",
  '<div class="ph">' + mbar() +
  '<div style="flex:1;overflow:hidden">%s</div>'
  '<div class="sheet" style="background:#1c1a19;height:566px"><div class="grab"></div>'
    '<div class="sheet-hd"><span class="lbl">Inspect</span><span class="spacer"></span>'
    '<span style="color:var(--ink-400)">%s</span></div>%s'
    '<div style="margin-top:auto;display:flex;gap:9px;padding:12px 16px 26px;'
    'border-top:1px solid var(--ink-750)">'
      '<span class="tap" style="flex:1;background:var(--amber);color:var(--amber-ink)">%s Add to deck</span>'
      '<span class="tap" style="flex:1;border:1px solid var(--ink-650);color:var(--ink-300)">Not for this deck</span>'
    '</div></div></div>' % (swipe_demo, I_X, insp_m, I_CHECK), css_extra=M_EXTRA)

# ============================ Import / Export ============================
IO_EXTRA = """
.scrim{position:absolute;inset:0;background:rgba(8,7,7,.72)}
.modal{position:absolute;border-radius:12px;border:1px solid var(--ink-650);background:var(--ink-850);
  box-shadow:0 30px 80px rgba(0,0,0,.75);display:flex;flex-direction:column;overflow:hidden}
.modal-hd{display:flex;align-items:center;gap:11px;padding:16px 20px;border-bottom:1px solid var(--ink-750)}
.modal-ft{display:flex;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid var(--ink-750);
  background:var(--ink-800)}
.paste{background:var(--ink-900);border:1px solid var(--ink-700);border-radius:8px;padding:12px 13px;
  font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.72;color:var(--ink-300);
  overflow:hidden;height:100%}
.paste .cm{color:var(--amber)} .paste .bad{color:var(--danger);text-decoration:underline;
  text-decoration-style:wavy;text-underline-offset:3px} .paste .ill{color:var(--warn)}
.paste .ln{color:var(--ink-600);display:inline-block;width:22px}
.sum{display:flex;align-items:center;gap:9px;padding:8px 0;font-size:12px;color:var(--ink-200)}
.sum i{width:17px;height:17px;border-radius:5px;display:grid;place-items:center;flex:none}
.fix{border:1px solid var(--ink-700);border-radius:8px;padding:11px 12px;margin-top:9px;
  background:var(--ink-800)}
.fix-t{font-size:11.5px;color:var(--ink-200);line-height:1.5}
.fix-t b{font-family:'IBM Plex Mono',monospace;font-weight:500;color:var(--danger)}
.fix-o{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}
.fix-b{height:28px;padding:0 10px;border-radius:6px;border:1px solid var(--ink-650);background:var(--ink-780);
  font-size:11.5px;color:var(--ink-200);display:inline-flex;align-items:center}
.fix-b.pri{border-color:var(--amber-3);background:#241a0c;color:var(--amber)}
.opt{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:8px;
  border:1px solid var(--ink-700);margin-bottom:8px}
.opt.on{border-color:var(--amber);background:#1d1913}
.rad{width:15px;height:15px;border-radius:50%;border:1.5px solid var(--ink-600);flex:none;
  display:grid;place-items:center}
.opt.on .rad{border-color:var(--amber)}
.opt.on .rad::after{content:'';width:7px;height:7px;border-radius:50%;background:var(--amber)}
.opt-n{font-size:12.5px;color:var(--ink-100);font-weight:500}
.opt-h{font-size:10.5px;color:var(--ink-500);margin-left:auto}
.note{display:flex;gap:9px;padding:11px 12px;border-radius:8px;background:#1a1611;
  border:1px solid #3a2c14;font-size:11px;color:var(--ink-300);line-height:1.55}
"""

paste_txt = (
  '<span class="ln">1</span>1 Krenko, Mob Boss <span class="cm">*CMDR*</span><br>'
  '<span class="ln">2</span>1 Sol Ring<br>'
  '<span class="ln">3</span>1 Arcane Signet<br>'
  '<span class="ln">4</span>1 <span class="bad">Goblin Bombadier</span><br>'
  '<span class="ln">5</span>1 Skullclamp<br>'
  '<span class="ln">6</span>1 Purphoros, God of the Forge<br>'
  '<span class="ln">7</span>1 Zealous Conscripts<br>'
  '<span class="ln">8</span>1 Goblin Recruiter<br>'
  '<span class="ln">9</span>1 Krenko\'s Command<br>'
  '<span class="ln">10</span>SORCERY (4)<br>'
  '<span class="ln">11</span>1 Jeska\'s Will<br>'
  '<span class="ln">12</span>1 Chaos Warp<br>'
  '<span class="ln">…</span><br>'
  '<span class="ln">51</span>1 <span class="ill">Birds of Paradise</span><br>'
  '<span class="ln">52</span>34 Mountain<br>')

def sumrow(icon, bg, col, txt):
    return '<div class="sum"><i style="background:%s;color:%s">%s</i><span>%s</span></div>' % (bg, col, icon, txt)

import_modal = ('<div class="modal" style="left:150px;top:70px;width:1140px;height:760px">'
  '<div class="modal-hd"><span class="disp" style="font-size:16px;font-weight:600">Import decklist</span>'
    '<span style="font-size:11.5px;color:var(--ink-500)">paste, or drop a .txt / .csv / .dec / .json</span>'
    '<span class="spacer"></span><span style="color:var(--ink-400)">%s</span></div>'
  '<div style="display:flex;flex:1;overflow:hidden">'
    '<div style="flex:1;padding:16px 16px 16px 20px;min-width:0;display:flex;flex-direction:column">'
      '<div style="flex:1;min-height:0">%s</div></div>'
    '<div style="width:432px;flex:none;border-left:1px solid var(--ink-750);padding:16px 20px;overflow:hidden">'
      '<span class="lbl">Commander</span>'
      '<div style="display:flex;align-items:center;gap:11px;margin:9px 0 14px">'
        '<span class="cmdr-art" style="width:40px;height:40px;border-radius:6px"></span>'
        '<span><span class="cmdr-nm" style="font-size:14px">Krenko, Mob Boss</span>'
        '<span class="cmdr-sub">detected from <span class="mono" style="color:var(--amber)">*CMDR*</span> marker</span></span>'
        '<span class="spacer"></span><span class="chip" style="height:26px;font-size:11px">Change</span></div>'
      '<div style="border-top:1px solid var(--ink-780);padding-top:6px">%s%s%s%s</div>'
      '<div class="fix"><div class="fix-t">Line 4 &nbsp;<b>Goblin Bombadier</b> &nbsp;didn\'t match a card.</div>'
        '<div class="fix-o"><span class="fix-b pri">Goblin Bombardment</span>'
        '<span class="fix-b">Goblin Bombardier</span>'
        '<span class="fix-b" style="color:var(--ink-500)">%s search…</span>'
        '<span class="fix-b" style="color:var(--ink-500);margin-left:auto">skip line</span></div></div>'
      '<div class="fix"><div class="fix-t">Line 51 &nbsp;<b style="color:var(--warn)">Birds of Paradise</b>'
        ' &nbsp;is green — outside Krenko\'s colour identity.</div>'
        '<div class="fix-o"><span class="fix-b">import and flag</span>'
        '<span class="fix-b pri">skip</span></div></div>'
      '<div style="margin-top:16px"><span class="lbl">Import as</span>'
        '<div style="margin-top:9px">'
        '<div class="opt on"><span class="rad"></span><span class="opt-n">A new deck</span></div>'
        '<div class="opt"><span class="rad"></span><span class="opt-n">Merge into “Goblins, all the way down”</span>'
        '<span class="opt-h mono">64</span></div></div></div>'
    '</div></div>'
  '<div class="modal-ft"><span style="font-size:11px;color:var(--ink-500)">'
  'Nothing is added until you confirm.</span><span class="spacer"></span>'
    '<button class="mini" style="height:36px;padding:0 16px">Cancel</button>'
    '<button class="mini" style="height:36px;padding:0 18px;background:var(--amber);color:var(--amber-ink);'
    'border-color:var(--amber);font-weight:600;font-size:12.5px">Import 96 cards</button></div>'
  '</div>' % (I_X, '<div class="paste">%s</div>' % paste_txt,
    sumrow(I_CHECK, "#22271e", "var(--good)", '<b style="font-weight:600">96</b> cards resolved'),
    sumrow(I_WARN, "#33240c", "var(--warn)", '<b style="font-weight:600">1</b> line needs attention'),
    sumrow(I_WARN, "#33240c", "var(--warn)", '<b style="font-weight:600">1</b> outside colour identity'),
    sumrow(I_LOCK, "#26221c", "var(--ink-400)", '<b style="font-weight:600">2</b> user categories kept as tags'),
    I_SEARCH))

write("Import.dc.html",
  '<div style="width:1440px;height:900px;position:relative;overflow:hidden;background:var(--ink-900)">'
  + cmdbar(2) +
  '<div class="work"><div class="pane" style="width:46%%">%s<div class="pane-body">%s</div></div>'
  '<div class="vdiv"></div><div class="pane" style="flex:1">%s<div class="pane-body">%s</div></div></div>'
  '<div class="scrim"></div>%s</div>'
  % (accepted_hd(), acc2, cand_hd(), can2, import_modal),
  css_extra=Q_EXTRA + IO_EXTRA)

def eopt(nm, hint, on=False):
    return ('<div class="opt%s"><span class="rad"></span><span class="opt-n">%s</span>'
            '<span class="opt-h">%s</span></div>' % (" on" if on else "", nm, hint))

export_panel = ('<div style="border-radius:12px;border:1px solid var(--ink-650);background:var(--ink-850);'
  'overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.6)">'
  '<div class="modal-hd"><span class="disp" style="font-size:15px;font-weight:600">Export</span>'
    '<span style="font-size:11.5px;color:var(--ink-500);overflow:hidden;white-space:nowrap;'
    'text-overflow:ellipsis">Goblins, all the way down</span>'
    '<span class="spacer"></span><span style="color:var(--ink-400)">%s</span></div>'
  '<div style="padding:16px 20px">'
    '%s%s%s%s%s'
    '<div class="paste" style="height:150px;margin-top:13px">'
      '1 Krenko, Mob Boss <span class="cm">*CMDR*</span><br>'
      '<br><span style="color:var(--ink-500)">// Ramp</span><br>'
      '1 Sol Ring<br>1 Arcane Signet<br>1 Commander\'s Sphere<br>'
      '<br><span style="color:var(--ink-500)">// Win conditions</span><br>'
      '1 Purphoros, God of the Forge<br>1 Goblin Bombardment<br>…</div>'
    '<div class="note" style="margin-top:13px">%s'
      '<span>Text keeps your 100 cards. It does <b style="color:var(--ink-100)">not</b> keep exclusions, '
      'locks, your archetype or snapshots — choose <b style="color:var(--ink-100)">Roundtable JSON</b> '
      'if you want to bring the deck back exactly.</span></div>'
  '</div>'
  '<div class="modal-ft"><button class="mini" style="height:36px;padding:0 14px">Download</button>'
    '<span class="spacer"></span>'
    '<button class="mini" style="height:36px;padding:0 18px;background:var(--amber);color:var(--amber-ink);'
    'border-color:var(--amber);font-weight:600;font-size:12.5px">%s Copy to clipboard</button></div>'
  '</div>' % (I_X,
    eopt("Plain text", "universal"),
    eopt("Moxfield / Archidekt", "commander marker + categories", True),
    eopt("MTGO .dek", "XML"),
    eopt("CSV", "spreadsheet"),
    eopt("Roundtable JSON", "lossless"),
    '<span style="color:var(--amber);flex:none;margin-top:1px">%s</span>' % I_WARN,
    I_CHECK))

delete_panel = ('<div style="border-radius:12px;border:1px solid var(--ink-650);background:var(--ink-850);'
  'overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.6)">'
  '<div style="padding:18px 20px 16px">'
    '<div class="disp" style="font-size:15px;font-weight:600">Delete “Elfball (shelved)”?</div>'
    '<div style="font-size:11.5px;color:var(--ink-400);margin-top:6px">'
      '<span class="mono">91</span> cards &nbsp;·&nbsp; Bracket 3 &nbsp;·&nbsp; edited 2 months ago</div>'
    '<div style="margin-top:15px"><span class="fix-b pri" style="height:34px;padding:0 14px">'
      '%s Copy decklist first</span>'
      '<span style="font-size:10.5px;color:var(--ink-500);margin-left:11px">'
      'copies the list — doesn\'t cancel</span></div>'
    '<div style="font-size:11px;color:var(--ink-500);margin-top:16px;line-height:1.55">'
      'Recoverable from Archived for <b style="color:var(--ink-300)">30 days</b>, then permanently gone.</div>'
  '</div>'
  '<div class="modal-ft"><span class="spacer"></span>'
    '<button class="mini" style="height:36px;padding:0 16px">Cancel</button>'
    '<button class="mini" style="height:36px;padding:0 16px;border-color:#5e2a24;background:#2a1210;'
    'color:var(--danger);font-weight:600;font-size:12.5px">Delete deck</button></div>'
  '</div>' % I_CHECK)

write("Export.dc.html",
  '<div style="width:620px;height:900px;background:var(--ink-900);padding:22px;overflow:hidden;'
  'display:flex;flex-direction:column;gap:22px">'
  '%s'
  '<div><div style="display:flex;align-items:center;gap:9px;margin-bottom:11px">'
    '<span class="lbl">And when you\'re done with it</span>'
    '<span style="flex:1;height:1px;background:var(--ink-780)"></span></div>%s</div>'
  '</div>' % (export_panel, delete_panel),
  css_extra=IO_EXTRA)
