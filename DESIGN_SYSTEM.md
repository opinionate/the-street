# The Street -- Cyberpunk Design System

This document defines the visual language for The Street. Every UI panel, 3D label, HUD element, and scene material must conform to these guidelines. When building anything with a visual component, reference this file.

---

## Core Principles

1. **Dark-first**: Near-black backgrounds with luminous accents. Never bright/white backgrounds.
2. **Translucent layers**: UI panels float over the 3D scene with transparency, not solid fills.
3. **Accent-driven identity**: Each system/role has a signature accent color. Use it for borders, text, and glow -- not backgrounds.
4. **Minimal chrome**: Sharp corners (border-radius: 3-6px max). No rounded pill shapes. No drop shadows -- use border glow instead.
5. **Monospace for data, sans-serif for prose**: Technical readouts and labels use `Courier New, monospace`. Body text uses `system-ui, sans-serif`.
6. **Glow over gradients**: Subtle `shadowBlur` / `text-shadow` / `box-shadow` for emphasis. Never gradient backgrounds.

---

## Color Palette

### Backgrounds

| Token | Value | Usage |
|-------|-------|-------|
| `bg-void` | `#050508` / `rgba(5, 5, 8, 1)` | Scene background, deepest layer |
| `bg-surface` | `rgba(10, 10, 15, 0.95)` | Panel backgrounds, modals |
| `bg-overlay` | `rgba(5, 5, 15, 0.75)` | 3D labels, floating HUD elements |
| `bg-input` | `rgba(255, 255, 255, 0.06)` | Input fields, text areas |
| `bg-input-hover` | `rgba(255, 255, 255, 0.08)` | Input hover / button idle |
| `bg-highlight` | `rgba(255, 255, 255, 0.15)` | Selected items, active states |

### Text

| Token | Value | Usage |
|-------|-------|-------|
| `text-primary` | `rgba(255, 255, 255, 0.9)` | Primary readable text |
| `text-secondary` | `rgba(255, 255, 255, 0.6)` | Descriptions, secondary info |
| `text-muted` | `rgba(255, 255, 255, 0.35)` | Timestamps, hints, disabled |
| `text-disabled` | `rgba(255, 255, 255, 0.25)` | Fully disabled text |

### Accent Colors (Semantic)

Each accent is used at full intensity for text/icons, at `0.2` alpha for button backgrounds, and at `0.4` alpha for borders.

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `accent-cyan` | `#00ffff` | `0, 255, 255` | Primary brand, neon trim, player labels |
| `accent-green` | `#44ff88` | `68, 255, 136` | Success, daemon speech, NPC tags, greeter accent |
| `accent-blue` | `#4488ff` | `68, 136, 255` | Links, info, guide accent, upload actions |
| `accent-orange` | `#ff8c00` | `255, 140, 0` | Warnings, creation flows, shopkeeper accent |
| `accent-red` | `#ff4444` | `255, 68, 68` | Errors, destructive actions, admin, guard accent |
| `accent-purple` | `#aa44ff` | `170, 68, 255` | Roamer accent, behavior events |
| `accent-pink` | `#ff44aa` | `255, 68, 170` | Socialite accent |
| `accent-gold` | `#ffcc66` | `255, 204, 102` | Lamp light, warm highlights |

### Daemon Role Colors (3D)

Used for NPC body accents, name label borders/text, and role identification.

| Role | Hex | 3D Hex |
|------|-----|--------|
| Greeter | `#44ff88` | `0x44ff88` |
| Shopkeeper | `#ffaa00` | `0xffaa00` |
| Guide | `#4488ff` | `0x4488ff` |
| Guard | `#ff4444` | `0xff4444` |
| Roamer | `#aa44ff` | `0xaa44ff` |
| Socialite | `#ff44aa` | `0xff44aa` |

### Borders

| Token | Value | Usage |
|-------|-------|-------|
| `border-subtle` | `rgba(255, 255, 255, 0.08)` | Section dividers, hairlines |
| `border-default` | `rgba(255, 255, 255, 0.15)` | Input borders, panel edges |
| `border-accent` | `rgba(accent, 0.4)` | Accent-colored borders (use role/semantic color) |
| `border-accent-bright` | `rgba(accent, 0.7)` | Focus states, active borders |

---

## Typography

### Font Stacks

| Purpose | Font |
|---------|------|
| Body / UI | `system-ui, sans-serif` |
| Data / Labels / Code | `'Courier New', monospace` |

### Scale

| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| `text-xs` | `10px` | normal | Timestamps, status indicators |
| `text-sm` | `11px` | normal | Hints, secondary labels, tags |
| `text-base` | `13px` | normal | Body text, list items |
| `text-md` | `14px` | normal | Input text, panel descriptions |
| `text-lg` | `16px` | 600 | Panel titles, section headers |
| `text-xl` | `22px` | bold | 3D name labels (canvas) |
| `text-hero` | `36px` | bold | Login title, splash text |

---

## Components

### Panels (DOM)

```
background: rgba(10, 10, 15, 0.95);
border: 1px solid rgba(accent, 0.4);       // accent matches panel purpose
border-radius: 6px;
font-family: system-ui, sans-serif;
color: rgba(255, 255, 255, 0.9);
```

Panel title format: `<span style="color:{accent};font-weight:bold">KEYWORD</span> Description`
Example: `<span style="color:#ff4444;font-weight:bold">ADMIN</span> Dashboard`

### Buttons

**Primary (accent-colored):**
```
background: {accent}33;                     // accent at 0.2 alpha
border: 1px solid {accent}88;              // accent at 0.53 alpha
border-radius: 6px;
color: {accent};
font-size: 13px;
padding: 8px 16px;
cursor: pointer;
```

**Secondary (neutral):**
```
background: rgba(255, 255, 255, 0.08);
border: 1px solid rgba(255, 255, 255, 0.2);
border-radius: 4px;
color: rgba(255, 255, 255, 0.7);
font-size: 12px;
padding: 4px 12px;
cursor: pointer;
```

### Inputs

```
background: rgba(255, 255, 255, 0.06);
border: 1px solid rgba(255, 255, 255, 0.15);
border-radius: 4px;
color: white;
font-size: 12-13px;
padding: 6px 8-10px;
font-family: system-ui, sans-serif;
```

Focus state: `border-color: rgba(accent, 0.7);`

### Tags / Badges

```
font-size: 10-11px;
font-weight: bold;
color: {accent};
background: rgba(accent, 0.15);
padding: 1px 4px;
border-radius: 2px;
```

---

## 3D Labels (Canvas-rendered sprites)

All floating labels above characters and objects use canvas-rendered textures on THREE.Sprite.

### Construction Pattern

1. **Measure text** with `ctx.measureText()` to get actual width
2. **Size canvas** dynamically: `width = textWidth + (padding * 2)`, `height = 40`
3. **Draw background**: `rgba(5, 5, 15, 0.75)`, rounded rect with `borderRadius: 3`
4. **Draw accent border**: 1.5px stroke at `rgba(accent, 0.7)`
5. **Draw accent underline**: 1px line near bottom at `rgba(accent, 0.5)`
6. **Draw text**: Monospace font (`'Courier New', monospace`), bold 22px, with `shadowBlur: 6` in accent color
7. **Scale sprite**: Calculate `aspect = canvasWidth / canvasHeight`, set `sprite.scale.set(height * aspect, height, 1)` where height ~0.22

### Label Colors by Entity

| Entity | Text Color | Border/Glow Color |
|--------|-----------|-------------------|
| Player | `#d0f0ff` | `rgba(0, 200, 255, *)` (cyan) |
| Daemon | Lightened role accent | Role accent color |
| Object | `rgba(255, 255, 255, 0.85)` | `rgba(255, 255, 255, 0.25)` |

### Positioning

- **Name labels**: `y = 2.1` (well above head)
- **Chat bubbles**: Stack above name label

---

## Scene & Lighting

### Environment

| Element | Color | Notes |
|---------|-------|-------|
| Sky / background | `0x050508` | Void black |
| Fog | `0x050508` | near: 150, far: 400 |
| Street surface | `0x101018` | Dark asphalt |
| Sidewalk | `0x12121c` | Slightly lighter |
| Ground (center) | `0x080810` | Beneath street |
| Ground (outer) | `0x060610` | Fading to void |
| Plot floor | `0x0d0d18` | With emissive `0x110022` |
| Neon trim | `0x00ffff` | Cyan, 0.6 opacity |

### Lighting Rig

| Light | Color | Intensity | Purpose |
|-------|-------|-----------|---------|
| Ambient | `0xccccdd` | 2.0 | Base fill |
| Moon (directional) | `0xccccff` | 2.5 | Primary directional |
| Fill (directional) | `0xddccaa` | 1.2 | Warm counter-fill |
| Hemisphere | sky: `0x8899cc`, ground: `0x554466` | 0.8 | Ambient color variation |
| Lamp posts | `0xffcc66` | 2.0 | Warm street lamps, range: 20 |

### Preview Scene (panels)

| Element | Value |
|---------|-------|
| Background | `0x14141e` |
| Ambient | white, 0.6 |
| Key light | white, 0.8 |
| Fill light | `0x4488ff`, 0.3 |

---

## Chat Message Colors

| Type | Name Color | Text Color | Style |
|------|-----------|------------|-------|
| Player | `#ffffff` | `#ffffff` | normal |
| Player emote | `#dddddd` | `#cccccc` | italic |
| Daemon chat | `#66ff99` | `#ccffcc` | normal |
| Daemon emote | `#999999` | `#aaaaaa` | italic |
| Daemon thought | `#6699ff` | `#99bbff` | italic |
| Daemon speech | `#44ff88` | `#eeffee` | normal |
| System | `#ffaa44` | `#ffcc88` | italic |

---

## Activity Log Type Colors

| Type | Color |
|------|-------|
| `conversation_turn` | `#44cc88` |
| `conversation_summary` | `#44aaff` |
| `manifest_amendment` | `#ffaa44` |
| `manifest_recompile` | `#ff8844` |
| `behavior_event` | `#aa88ff` |
| `inter_daemon_event` | `#88ccff` |
| `budget_warning` | `#ffcc44` |
| `inference_failure` | `#ff4444` |

---

## Anti-patterns (Do NOT)

- White or light backgrounds on any surface
- `border-radius` > 6px (no pills, no circles for containers)
- Gradient fills on buttons or panels
- `drop-shadow` or `box-shadow` with offset (use glow-only: `0 0 Npx color`)
- Bright solid-color backgrounds (use translucent accent tints instead)
- Sans-serif fonts on 3D canvas labels (always monospace)
- Fixed-width name labels (always measure and size dynamically)
- System default scrollbar appearance (style with `scrollbar-color: rgba(255,255,255,0.2) transparent`)
