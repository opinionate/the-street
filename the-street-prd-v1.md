# The Street — Product Requirements Document

## Overview

The Street is an open, persistent virtual world inspired by the Metaverse in Neal Stephenson's *Snow Crash*. It is a shared, continuous environment where any user can build, interact, and participate using natural language and AI-assisted creation tools. No programming knowledge is required.

The Street is a spiritual successor to Minecraft, Second Life, and other open virtual worlds, differentiated by one core premise: AI collapses the gap between imagination and execution, making world-building accessible to everyone.

The platform rewards sustained creative contribution over time. Position, visibility, and operational privileges are earned through demonstrated community value, never purchased.

---

## Foundational Principles

### 1. Accessibility of Creation
Building requires intent, not technical skill. The AI layer translates what a user wants into what gets built. No scripting languages, mesh editors, or shader knowledge required. Users describe, iterate, and refine. Every creator has access to every design tool the system offers, regardless of their current position in the world.

### 2. Persistent, Contiguous Space
The world is one shared, continuous environment. Not instanced, not sharded from the user's perspective. What you build exists for everyone. Geography matters. Proximity matters. When areas exceed capacity, users are informed transparently rather than silently separated.

### 3. Land as an Earned Resource
Plots are finite and spatially meaningful. Plot position is determined by sustained community contribution, measured through a composite score of foot traffic, dwell time, repeat visits, and asset adoption. Scarcity creates value, incentivizes quality, and forces prioritization. No plot position is permanent. Positions are earned and maintained through ongoing engagement.

### 4. Meritocratic Visibility
The best work gets the best exposure through a promotion and relegation system. Investment of time, creativity, and effort compounds into attention, foot traffic, and reputation. Visibility is earned through sustained performance, not early arrival or payment.

### 5. User Sovereignty
Your plot, your rules. Within building code constraints, creators control what happens on their land: who can enter (if they've earned access control privileges), what interactions are possible, what the experience is. The platform provides physics, rendering, and AI tooling. Creators provide everything else. Public space between plots is PVP-enabled, governed by combat mechanics and the moderation system.

### 6. Open Protocol, Not Walled Garden
The world runs on open standards. Assets, scripts, and structures are portable and inspectable. No vendor lock-in. If the platform disappears, the data survives. V1 architectural decisions preserve decentralization optionality without committing to a decentralization timeline.

### 7. Composability
Creations are remixable and stackable. Copying is allowed and treated as an attribution engine, not theft. Placing a copied asset automatically credits the original creator. AI tooling mediates between different creators' work, resolving conflicts and maintaining coherence.

### 8. Economic Integrity
Effort-based rewards. Time and creativity are the primary inputs. Avatar quality signals investment of attention, not wealth. Real-money transactions, if they exist, are peer-to-peer, not platform-extractive.

### 9. Governance Through Subsidiarity
Rules evolve from the community, scoped to the level most affected by each decision. Mechanical systems (promotion/relegation, budgets) are platform-set. Aesthetic decisions are neighborhood-driven. Content moderation is jury-based with equal voice. Platform policy is one-creator-one-vote. Power is never permanent. Governance weight is tied to current position, which is tied to current performance. The governance framework is a design target. Each domain activates when the community reaches sufficient scale. Until activation, the platform operator makes all decisions with documented reasoning, establishing precedent.

### 10. Liveness
The world exists whether you're in it or not. Other people build. The environment changes. When you return, the world has moved forward. Plots that fail to maintain engagement are relegated. Plots that thrive are promoted. The world is always in motion.

---

## World Geometry

The Street is organized as a set of concentric rings. The innermost ring is The Street itself, the premium showcase boulevard equivalent to the Esplanade at Burning Man. Outer rings have progressively more plots due to larger circumference. The world expands outward over time by adding new rings, and laterally by adding new neighborhood slices.

### The Street (Inner Ring)

The innermost ring is The Street. This is the name's referent: a circular boulevard where every neighborhood's best work has frontage. The monorail runs The Street. Navigation along The Street is one-dimensional: clockwise or counterclockwise, passing through every neighborhood's most prestigious builds. "I got promoted to The Street" is a meaningful sentence. "I'm three rings out from The Street in cyberpunk" is legible.

### Rings

Each ring is a complete circle. All plots have identical build dimensions regardless of which ring they occupy. Outer rings have greater spacing between plots, creating interstitial space governed by a stewardship model (see Interstitial Space below).

The inner ring concentrates the highest-quality builds at the highest density. This creates both the best showcase and the heaviest rendering load, which is addressed through disproportionate infrastructure investment rather than budget constraints on creators.

Outer rings offer something The Street does not: space. The lower density and available interstitial space around plots allows for larger environmental installations, landscaped surroundings, and a fundamentally different creative experience. Some creators will prefer this, making outer rings a legitimate creative choice rather than a consolation prize.

### Interstitial Space

The space between plots on outer rings is public commons. Adjacent plot owners can steward this space but do not own it.

Stewardship rules:

- Cosmetic only. Landscaping, lighting, pathways, seating, decoration. No walled structures, no access control, no daemons stationed there.
- Revocable. When a creator is promoted or relegated and a new creator takes the adjacent spot, stewardship transfers.
- Always public, always traversable, always PVP space.
- Stewardship contributions do not count toward the creator's composite score.
- On The Street (inner ring) where interstitial space is minimal or nonexistent, stewardship does not apply.

### Neighborhoods

The world is divided radially into neighborhoods: pie-slice sectors that cut across all rings. Each neighborhood has a distinct aesthetic identity enforced through a neighborhood-specific building code layered on top of the universal building code. Every neighborhood has equal frontage on The Street.

The Street launches with one neighborhood. The first neighborhood has the most permissive building code, close to the universal code only, with light aesthetic guidance rather than hard constraints. Its identity emerges from what the first creators actually build rather than being prescribed.

New neighborhoods are community-proposed. A second neighborhood opens when there is demonstrated demand: a group of creators who want a specific aesthetic and are willing to commit to populating it. The proposing community must demonstrate enough interested creators to populate at least the outermost ring's slice. Neighborhoods are never platform-designated. They are always community-proposed and community-populated.

The radial slice structure, per-neighborhood building codes, and neighborhood governance all activate when a second neighborhood is proposed. The architecture supports the full neighborhood system from day one but the feature is dormant until there is demand.

A creator who migrates between neighborhoods starts with decayed governance weight in the new neighborhood, which rebuilds over 1–2 promotion/relegation cycles.

### Promotion and Relegation

Plot position is earned and maintained through sustained performance.

**Composite Score.** Promotion and relegation are determined by a composite score with published weights.

Primary triad:

| Metric | What it measures | Why it resists gaming |
|---|---|---|
| Foot traffic | Attention | Insufficient alone; anchored by dwell time and repeat visits |
| Dwell time | Quality of experience | Requires giving visitors a reason to stay |
| Repeat visits | Sustained appeal | Requires ongoing value, not one-time spectacle |

Secondary modifier:

| Metric | What it measures | Why it resists gaming |
|---|---|---|
| Asset adoption | Creative contribution to the ecosystem | Independent of plot location |

All metrics are measured as a recency-weighted 128-day rolling average. Recent activity counts more than older activity, using an exponential decay so that the last 30 days contribute more to the score than the first 30 days. This preserves the 128-day window (sustained performance matters, not one-week spikes) while allowing dramatic improvements to surface within weeks rather than waiting for old data to wash out. Traffic is measured relative to ring average, not absolute numbers. A plot outperforming its ring peers is recognized regardless of which ring it occupies.

Dwell time is counted only while the visitor has a clear exit path. If a visitor teleports out rapidly (within seconds of entry), that visit is excluded from the plot's dwell time metric and counted as a negative signal in the composite score. Ignore counts function as a negative signal in the composite score (see Ignore System).

The weights are a mechanical rule set by the platform, not voted on. They can be tuned over time based on observed behavior. The composite score and its components are visible to every creator for their own plot.

**Cycles.** Every 128 days, the bottom performers on each ring are relegated to the next ring outward, and the top performers on the next ring out are promoted inward. The same count is promoted as relegated per ring boundary.

**Grace periods.** New plots receive one full cycle (128 days) before becoming relegation-eligible. Newly promoted plots receive one cycle of grace before being measured against their new ring's averages.

**Build continuity.** When a plot is promoted or relegated, the build remains intact. Only the address changes. The creator does not rebuild.

**Open items.** The exact number of plots promoted/relegated per cycle per ring boundary is TBD (fixed count vs. fixed percentage vs. bracketed scaling). The total number of rings at launch is TBD. Specific plot footprint dimensions are TBD.

### Addressing

Every plot has two identifiers:

**Plot address** — a tuple of neighborhood, ring, and position-within-neighborhood-and-ring. This is the plot's current location. It changes on promotion or relegation. Used for navigation, rendering, and spatial queries.

**Plot UUID** — a permanent identifier assigned at creation. Never changes regardless of promotion, relegation, or neighborhood migration. Used for reputation tracking, asset attribution, external links, and historical records. When someone shares a link to a plot, the system resolves the UUID to its current address at access time.

---

## Building Codes

### Universal Building Code

All builds on all rings must conform to the universal building code, enforced automatically by the placement validator. The universal code ensures minimum coherence without constraining creativity.

The universal code governs: PBR material system compliance (no custom shaders, no unlit surfaces), valid colliders matching visual geometry, ground-plane connection (no floating geometry), minimum transparency thresholds, maximum emissive brightness, structural coherence, signage limits, and visual pollution controls (effects that extend past plot boundaries).

The AI generation pipeline enforces the universal code automatically. Builds that fail validation receive specific feedback and the AI regenerates.

### Neighborhood Building Codes

Each neighborhood adds aesthetic constraints on top of the universal code. Neighborhood codes never remove universal constraints, only add to them.

A neighborhood code constrains: allowed material ranges (e.g., metallic and emissive for cyberpunk, organic and matte for pastoral), color temperature ranges, signage style rules, height-to-width ratios for streetscape coherence, lighting color restrictions, and other aesthetic parameters specific to the neighborhood's identity.

Neighborhood building codes are governed by neighborhood residents with ring-weighted voting. The AI creation pipeline incorporates neighborhood constraints into generation prompts, producing more consistently coherent results within each aesthetic zone.

The launch neighborhood's building code is the universal code plus minimal additions: enough to prevent visual chaos but not enough to enforce a specific style.

---

## Technology Stack

### Authoring Language: TypeScript (Constrained Subset)

LLMs generate TypeScript better than nearly any other language. The type system acts as a contract between creator intent and world behavior. Readable by non-programmers:

```typescript
door.onInteract(() => door.open({ speed: 2 }));
```

The platform exposes a sandboxed API surface: physics, rendering, audio, interaction, state. No filesystem access, no network calls, no unbounded loops. Creators compose with these primitives.

TypeScript is an acknowledged soft lock-in. The Wasm compilation target keeps the door open for future language support, but the AI pipeline, standard library, examples, and daemon system are all TypeScript. Adding a second language later is additive work (new pipeline, new bindings, new documentation), not a rewrite.

### Execution Layer: WebAssembly

TypeScript compiles to Wasm for execution. This provides hardware-level sandboxing, near-native performance, and a compilation target that other languages can eventually use.

### Asset Format: glTF

The canonical 3D format. Industry standard, open, well-supported. All world objects and avatar items are exportable as self-contained glTF files with embedded geometry, materials, textures, and attachment metadata.

### Material Model: PBR (Physically Based Rendering)

```typescript
interface Material {
  baseColor: HexColor | TextureRef;
  metallic: number;      // 0.0 to 1.0
  roughness: number;     // 0.0 to 1.0
  opacity: number;       // 0.0 to 1.0
  emissive?: HexColor;
  normalMap?: TextureRef;
}
```

### Client: Web-Based (V1)

Three.js or Babylon.js renderer. Open source from day one. Anyone can build an alternative client.

---

## Object System

Every object in the world conforms to a base schema. This is the contract the AI generates against.

```typescript
interface WorldObject {
  // Identity
  id: string;
  name: string;
  description: string;
  tags: string[];

  // Geometry
  mesh: MeshDefinition;
  collider: ColliderShape;
  boundingBox: BoundingBox;

  // Visual
  materials: MaterialMap;
  lighting?: LightEmission;

  // Placement
  origin: Vector3;
  defaultScale: Vector3;
  defaultRotation: Quaternion;
  snapPoints?: SnapPoint[];

  // Behavior
  states?: StateDefinition[];
  interactions?: Interaction[];
  animations?: Animation[];
  sounds?: SoundTrigger[];

  // Performance
  lodLevels?: LODMesh[];
  renderCost: number;

  // Physics
  physics: PhysicsProfile;
}

interface PhysicsProfile {
  mass: number;
  isStatic: boolean;
  gravityAffected: boolean;
  friction: number;
  restitution: number;
}
```

### Behavioral Primitives

Objects compose from a finite set of interaction types:

```typescript
type InteractionType =
  | "toggle"      // two-state switch (door, light, lid)
  | "hold"        // continuous while engaged (lever, crank)
  | "trigger"     // one-shot event (button, tripwire)
  | "container"   // can receive/dispense objects
  | "seat"        // avatar can sit/mount
  | "portal"      // transports avatar
  | "display"     // shows dynamic content (screen, sign)
  | "emitter"     // produces particles or objects
  | "audio"       // plays sound on interaction
```

These are composable. A jukebox is `trigger` + `audio` + `display`. A mailbox is `container` + `toggle`.

---

## Asset System

Three tiers of assets:

### Platform Primitives (`std:` namespace)
Maintained by the platform. Always available. Guaranteed performance and compatibility. Architectural elements, furniture, vegetation, lighting fixtures, terrain features, vehicles, common props. Each is a TypeScript class with sensible defaults, visual parameters that can be restyled, and interaction hooks that can be overridden.

```typescript
const door = world.place("std:door", {
  style: "colonial",
  material: "oak",
  width: 0.9,
  height: 2.1
});
door.onInteract(() => door.toggle());
```

### Community Assets (Marketplace)
Published by users. Rated, versioned, dependency-tracked. Range from simple props to complex interactive installations.

### AI-Generated on Demand
User describes something not in the library, AI generates it in real time. Quality is constrained by the universal and neighborhood building codes, ensuring minimum coherence. Can be replaced with a polished community asset later.

Generation pipeline:
1. User provides natural language description
2. System prompt + schema + constraints + neighborhood code + few-shot examples sent to AI
3. AI generates TypeScript object definition + mesh description
4. Validator checks schema conformance, building code compliance, budget limits, physics sanity
5. If valid: mesh generator converts description to renderable geometry
6. If invalid: AI receives error feedback, regenerates
7. Object placed in world

For objects resembling known archetypes, the AI selects and modifies a base mesh from the platform library. For novel objects, the description routes to a 3D model generation service. For simple geometric objects, the AI produces CSG (constructive solid geometry) operations.

### Asset Attribution and Protection

No DRM. Copying is allowed and reframed as an attribution engine.

Every asset receives a signed creation record stored in a content-addressed registry (not in file metadata, which is trivially strippable):

- Creator's public key
- Content hash
- Timestamp
- Dependency list (referenced source assets)

When a user places a copied asset, the system automatically displays attribution to the original creator. Creator reputation grows with each adoption of their work. The most-copied creators become the most recognized names on The Street regardless of their ring position.

Similarity detection targets only fraudulent re-registration: cases where someone runs an asset through a 3D tool to break the hash and re-registers it as original work, stripping attribution. Legitimate copying with intact attribution is encouraged.

The underlying architecture provides cryptographic provenance without NFT branding or a speculation layer.

---

## Avatar System

V1 is humanoid only. One standardized skeleton, one set of inverse kinematics, one animation state machine. Every interaction assumes bipedal locomotion, two hands, forward-facing perspective, human-scale proportions.

```typescript
interface AvatarDefinition {
  bodyType: BodyParameters;
  face: FaceParameters;
  skin: SkinParameters;
  hair: HairDefinition;
  clothing: ClothingSlot[];
  accessories: AccessorySlot[];
  animations: AnimationOverrides;
}
```

### Default Avatars

New users select from a small set (4–6) of clean, minimal generic avatars: the Clints and Brandys of The Street. These defaults are not visually degraded or marked as low-status. They are simple starting points that clearly signal "I haven't customized yet" without signaling "I can't afford better."

### Customization

Avatar customization is effort-based, not payment-based. The AI creation tools make custom avatars accessible to anyone willing to engage. A user describes their desired appearance in natural language and the AI generates it. The barrier is engagement, not skill or money.

Avatar quality signals investment of attention. The path from a default Clint or Brandy to a fully custom avatar is open to all users immediately.

Clothing and accessories are the primary expression vector and the first marketplace economy driver.

---

## Daemons (AI NPCs)

User-created and user-owned software agents that inhabit the world as visible entities. Guard dogs, greeters, shopkeepers, research assistants, bouncers.

```typescript
interface Daemon {
  appearance: AvatarDefinition;
  behavior: BehaviorTree;
  knowledge?: KnowledgeBase;
  boundTo: PlotUUID;
  permissions: DaemonPermissions;
}
```

The AI-first architecture means any user can describe a daemon in natural language. The AI generates the daemon's behavior logic against the standard TypeScript API.

### Daemon Privileges by Ring

Basic daemons (greeters, simple shopkeepers) are available on all rings. Advanced daemon capabilities are operational privileges unlocked through ring progression:

- **All rings:** Basic daemons with simple behavior trees, single-user interactions
- **Inner rings:** Advanced daemons with sophisticated behavior, multi-user interaction, longer conversation memory, access control logic (bouncers), and cross-plot coordination

### Daemons in Public Space

Daemons can operate in public space (streets, interstitial areas) but are subject to combat mechanics. Any user can engage and destroy a daemon in public space. Destroyed daemons have escalating respawn cooldowns. This prevents daemon-based griefing while allowing legitimate public-facing daemon services.

Daemons weaken with distance from their owner's plot (home ring advantage). A daemon projected far from its home ring is significantly less effective in combat.

---

## Crowd Management

### Crowd Pressure System

Every area has a capacity. Crowd caps are set per ring segment (neighborhood + ring intersection). As crowd density increases, the system responds in stages:

**Stage 1: Avatar LOD degradation.** Distant avatars simplify progressively: lower poly count, simpler textures, reduced animation complexity. Builds always render at full quality. The architecture is the point; the crowd is context.

**Stage 2: Hard capacity.** When an area reaches its avatar cap, new arrivals enter a view-only overflow layer. They can see the builds and a representation of the crowd, but cannot interact with the primary layer. This is transparent: users know they are in overflow.

**Stage 3: Queue.** Overflow users are queued. When someone in the primary layer leaves, the next person in the queue is pulled in.

The crowd pressure system is honest. No fake continuity promises. Users always know whether they're in the primary layer or overflow.

Crowd pressure data feeds the promotion/relegation metrics. A plot that regularly generates overflow queues is demonstrably high-traffic.

### Crowd Cap Governance

Crowd cap increases for a ring segment are a collective decision made by the creators in that segment through ring-weighted voting. The tradeoff is explicit: higher cap means more avatars means more LOD degradation for everyone in that zone. Different neighborhoods can develop different crowd cultures. A neighborhood that values intimate experiences keeps caps low. A neighborhood that wants massive gatherings raises caps.

Until governance activates, the platform operator sets crowd caps based on infrastructure capacity and observed demand.

---

## The Monorail

Fast-travel running along The Street (the innermost ring), passing through every neighborhood's most prestigious frontage. Users board, ride, and see the world scroll past. Not a teleport. Forces visual exposure to what people have built. Functions as an audience delivery mechanism and a discovery equalizer.

The monorail is a safe zone. No combat while in transit.

The monorail has featured stops for high-performing builds on outer rings, preventing The Street from monopolizing attention. Featured stops are determined by the same relative-performance metrics that drive promotion/relegation.

The monorail also serves a technical purpose: travel time covers loading adjacent world segments.

---

## Combat

Combat serves as a real-time community enforcement mechanism, supplementing the formal moderation system. Public space is dangerous. Your plot is safe.

### Scope

**Public space is PVP.** The moment a user leaves their plot or a safe zone, they are in a combat-enabled zone. The Street, interstitial space, common areas: all PVP. Plots are sovereign: no one can attack builds, daemons, or avatars on another creator's plot without the plot owner's rules allowing it.

**Combat requires lock-on.** An aggressor must lock on to a target for a wind-up period (3–5 seconds, tunable) before combat initiates. During wind-up, the target receives a visible warning and can flee to a port safe radius, their own plot, or the monorail. The lock-on is visible to all nearby users and daemons, inviting intervention from local defenders. This makes the streets tense without making them instantly lethal.

**Ports have a safe radius.** A small buffer zone around materialization points where combat is disabled. Large enough to get your bearings. Small enough that it doesn't become a loitering zone.

**The monorail is safe.** No combat while in transit.

**Daemons are targetable anywhere in public space.** Any user can engage a daemon that has left its owner's plot.

### Mechanics

**Home ring advantage.** Daemons and avatars are more effective in combat near their home plot. Effectiveness degrades with distance. This prevents power projection: you can defend your neighborhood but you can't send a war party across the world.

**Defender advantage.** In any public-space engagement, the party whose plot is closer receives a mechanical bonus. This favors local defense over distant aggression.

**Escalating cooldowns.** Destroyed daemons have respawn timers that increase with each successive destruction. This makes griefing through persistent daemon redeployment uneconomical.

**No avatar levels.** There is no combat progression system. Combat effectiveness is determined by proximity to home and defender status, not accumulated power.

### Consequences

**Avatar death in public space:** Forced logout and a cooldown timer (minutes, not hours).

**Daemon destruction in public space:** Respawn timer scaled to recent destruction frequency.

**Build violations in public space:** Offending elements that extend past plot boundaries can be destroyed. The system flags the boundary violation. Repeated violations escalate to the formal moderation pipeline.

### Combat Feed

All combat actions are logged in a public feed: who fought whom, where, what was destroyed, relative standings. Teleport-out events (see Teleport-Out below) are logged in the same feed. The system provides transparency. The community provides judgment. Patterns of bullying, vigilantism, or abuse are visible to everyone and can be escalated to jury review.

---

## Teleport-Out

A universal visitor right. Any visitor on any plot can teleport out at any time, instantly returning to the nearest port safe radius. This ensures no visitor can be trapped on an adversarial plot.

### Rules

- Teleport-out is available anywhere on any plot at any time.
- Teleport deposits the visitor at the nearest port safe radius.
- Each teleport-out is logged: visitor ID, plot owner ID, plot UUID, timestamp, dwell time prior to teleport.
- The builder sees teleport-out events in their plot stats.

### Builder Signal

A plot with a high teleport-out-to-visit ratio is a signal that something is wrong with the experience. Rapid teleport-outs (within seconds of entry) are a stronger negative signal than teleport-outs after extended visits.

High rapid-teleport-out rates feed into the composite score as a negative signal. A plot that people consistently flee from immediately is not providing value. The builder sees their teleport-out count and rate and knows exactly why their score is suffering.

At extreme ratios, the system flags the plot for review in the moderation pipeline without requiring a user report.

---

## Ignore System

Users can ignore daemons, players, or entire plots.

**Ignore a daemon.** The daemon ceases to interact with you. Its speech is hidden, it cannot initiate conversation or block your path. It remains visually present but cannot affect your experience. The daemon owner's interaction metrics drop as more users ignore it.

**Ignore a player.** Their avatar remains visible but they cannot speak to you, trade with you, or initiate combat lock-on against you in public space.

**Ignore a plot.** The plot renders as a neutral placeholder. Blank facade, no audio bleed, no daemons reaching toward the boundary. You see that something is there but it cannot affect your experience. An ignored plot loses all metric credit for that visitor: foot traffic, dwell time, and repeat visits all zero for that user-plot pair.

### Tracking

Ignore counts are tracked per plot. High ignore rates are a signal to the system and to the jury pipeline. The creator sees their own ignore count. They do not see who ignored them. Ignore counts are not public (to prevent ignore counts from becoming a harassment metric) but the system uses them internally for pattern detection and as a negative signal in the composite score.

### Anti-Coordination Safeguard

A user who ignores an unusually high number of plots has their ignore events discounted from scoring impact. If the system detects that a user ignores a large fraction of plots they encounter, that user's ignores carry progressively less weight in the composite score calculation. This prevents coordinated ignore campaigns from being used to depress a competitor's metrics. The decay is proportional to ignore volume: occasional ignores have full impact, habitual ignores have diminishing impact.

---

## Moderation

A four-layer system, built from the bottom up as the community grows.

### Layer 1: Building Code Validator
Automated. Operates at placement time. Checks every build against the universal building code and the applicable neighborhood code. Rejects non-conforming builds with specific feedback. No human involvement required.

### Layer 2: Combat
Community-driven, real-time. Users and their daemons enforce norms in public space through the combat system. Effective for immediate responses to griefing, boundary violations, and antisocial daemon behavior.

### Layer 3: Jury-Based Review
Community-driven, deliberative. For disputes, appeals, and cases where combat is inappropriate or insufficient. Any creator active for a minimum period (two full 128-day cycles) without moderation actions against them is eligible for jury duty. Juries are randomly selected per case. No ring weighting. No neighborhood bias. Verdicts are public. Teleport-out logs, ignore patterns, and combat logs from the unified combat feed are available as evidence.

### Layer 4: Platform Override
Centralized, immediate. Reserved for illegal content, CSAM, doxxing, credible threats of harm. Non-negotiable. Not subject to community vote.

### Bootstrap Sequence

**Launch:** The platform operator serves as sole moderator. All moderation decisions are documented with reasoning, establishing case law and precedents for the community system.

**Growth phase:** Trusted early users are deputized as moderators. Hand-selected based on observed behavior. Operating under guidelines established through launch-phase precedents.

**Maturity:** Jury pool activates when the community is large enough (hundreds of active creators across multiple rings). The platform operator and team step back to Layer 4 (emergency override) only.

---

## Governance

Governance is domain-separated. Different types of decisions use different authority models. The full governance framework is a design target. Each domain activates when the community reaches sufficient scale. Until activation, the platform operator makes all decisions in each domain with documented reasoning, establishing precedent for the eventual community-operated system.

### Mechanical Rules
Promotion/relegation parameters, budget allocations, crowd caps (before cap governance activates). Set by the platform based on data. Not subject to vote. No creator votes on the formula that determines their own position. Always platform-set.

### Building Codes and Aesthetic Standards
Ring-weighted voting. Neighborhood residents get primary weight. Adjacent neighborhood residents get reduced weight. Distant neighborhoods get minimal weight. The people most affected by aesthetic decisions have the most say.

**Activates when:** A second neighborhood is proposed and enough creators exist to populate it. Before that, one neighborhood exists and the platform operator sets its code.

### Content Moderation Disputes
Jury-based. No ring or neighborhood weighting. Equal voice per juror. Prevents weaponization of moderation by high-status creators.

**Activates when:** The community has enough active creators to form juries without the same people serving constantly (hundreds of active creators across multiple rings).

### New Neighborhood Proposals
Ring-weighted voting with a minimum outer-ring support threshold. Inner-ring backing is necessary (they have governance weight) but outer-ring support is also required (they have a veto). A new neighborhood must demonstrate enough interested creators to populate at least the outermost ring's slice.

**Activates when:** There is demonstrated community demand for a second aesthetic zone.

### Platform-Level Policy
One-creator-one-vote regardless of ring or neighborhood. Constitutional-level decisions affect everyone equally.

**Activates when:** The creator base is large enough that unilateral platform decisions start affecting people who had no input. No specific threshold; judgment call.

### Neighborhood Migration
Creators who migrate between neighborhoods arrive with decayed governance weight in the new neighborhood. Weight rebuilds over 1–2 promotion/relegation cycles. This prevents colonization of neighborhoods by outsiders with outsized influence while allowing genuine migration.

---

## Operational Privileges by Ring

All creators have access to every design tool the system offers, on every ring, including in the staging environment. Design capability is a right.

Ring progression unlocks operational privileges: the ability to influence the shared experience beyond your plot boundaries. Operational influence over shared space is earned.

### All Rings
- Full AI creation pipeline (buildings, objects, avatars, basic daemons)
- Full staging environment with inner-ring toolset for prototyping
- Standard render/compute budget
- Basic daemons (greeters, simple interactions)
- Audio within plot boundaries

### Inner Rings (Earned Through Promotion)
- Maximum render/compute budget
- Access control and bouncer daemons
- Advanced daemon complexity (multi-user, extended memory, behavior sophistication)
- Event hosting with world calendar integration and monorail promotion
- Cross-plot interactions with adjacent plots (shared doorways, connected interiors, collaborative facades)
- Extended audio zones that bleed into the street
- Combat rule configuration on own plot

---

## Budget and Resource System

### Render Budget
Enforced at placement time. Every object has a declared renderCost. The plot has a cap that varies by ring, with The Street receiving the maximum budget.

### Compute Budget
Dynamic, enforced at runtime via metered Wasm execution.

```typescript
interface PlotBudget {
  render: {
    current: number;
    max: number;
    breakdown: Map<ObjectId, number>;
  };
  compute: {
    tickBudget: number;
    memoryBudget: number;
    networkBudget: number;
  };
}
```

- Wasm sandbox counts instructions, not wall-clock time. Deterministic and cheat-proof.
- Scripts exceeding tick budget in a frame halt for that frame. Graceful degradation, not crash.
- Memory allocation is hard-capped via Wasm linear memory maximum.
- Users see a real-time budget dashboard showing per-object resource consumption.

Creation is never blocked. Execution is metered. Users build without limits in staging, then the system profiles under simulated load before publishing.

### Inner Ring Infrastructure

Inner ring rendering load is handled through disproportionate infrastructure investment, not budget constraints on creators. The Street concentrates the most complex builds at the highest density with the largest crowds. This is addressed through:

- Aggressive avatar LOD (builds render at full quality, crowds become impressionistic)
- Streaming priority (inner-ring chunks get more server resources and bandwidth)
- Viewport-aware render scheduling (prioritize direct sightline, aggressively cull periphery)
- Sized for worst case (full crowd, every plot at maximum complexity)

---

## Input Abstraction

Hardware-agnostic interaction model. Interactions are defined as intents, not device-specific inputs.

```typescript
type InputIntent =
  | "select"
  | "grab"
  | "point"
  | "move"
  | "speak"
  | "emote"
  | "inspect"
  | "menu"
```

V1 maps these to mouse/keyboard. Future clients map to XR controllers, hand tracking, gaze control without changing any world logic.

---

## AI Creation Pipeline

### V1: Text to TypeScript
User describes in natural language. AI generates TypeScript against the world API, incorporating plot context, building code constraints, and neighborhood aesthetic rules. Validated against schema. Placed in world.

### Future: Multi-Modal
Voice-to-world. Gesture-to-world. The pipeline accepts multi-modal input from the start even though V1 only implements text.

### AI Prompt Architecture
Each generation request includes:
- Full schema definitions
- Current plot context (size constraints, existing objects)
- Universal building code rules
- Neighborhood building code rules
- Asset budget (remaining render/compute capacity)
- Few-shot examples of well-formed objects
- Validation rules (max vertex count, max texture resolution, required fields)

---

## Spatial Audio

A first-class system, not an add-on.
- Proximity-based voice communication
- Venue acoustics (indoor reverb, outdoor attenuation)
- Daemon speech
- Performance/stage audio
- Ambient audio scaling with crowd density
- Extended audio zones as an inner-ring operational privilege
- Formally specified as part of the scene graph, same as visual elements

---

## Networking Model

Persistent, contiguous, not instanced from the user's perspective. Behind the scenes, the world is spatially partitioned by ring segments.

- World servers own contiguous ranges of ring chunks
- Clients connect to whichever server owns their current chunk
- Handoff during movement is masked by chunk streaming
- The concentric ring structure allows partitioning by both ring and angular position
- Monorail travel time covers loading adjacent segments
- Inner-ring chunks receive disproportionate server resources

### Physics Authority
- Server-authoritative physics for interactions affecting other users
- Client-predictive physics for local-only effects
- Deterministic simulation across all clients to prevent cheating

---

## Persistence and State

```typescript
interface PersistentState {
  objectId: string;
  plotUUID: string;
  plotAddress: PlotAddress;
  stateData: Record<string, unknown>;
  lastModified: timestamp;
  modifiedBy: UserId | DaemonId;
}

interface PlotAddress {
  neighborhood: string;
  ring: number;
  position: number;
}
```

Every object's state persists independently. The ring and neighborhood structure maps to a partitioned database keyed on the address tuple.

---

## V1 Centralized Architecture

### Abstraction Interfaces

Every system that could eventually operate in a decentralized manner sits behind a clean interface. V1 implementations are centralized. The interfaces stay permanent.

```typescript
interface ChunkHost {
  getState(chunkId: string): ChunkState;
  applyAction(action: WorldAction): ActionResult;
  streamGeometry(viewport: Frustum): GeometryStream;
}

interface OwnershipRegistry {
  getPlotOwner(plotUUID: string): UserId;
  transferPlot(from: UserId, to: UserId, plot: PlotUUID): TransferReceipt;
  recordAsset(creator: UserId, assetHash: string): AttributionRecord;
}

interface BudgetAuthority {
  getBudget(plotUUID: string): PlotBudget;
  reportUsage(plotUUID: string, usage: UsageReport): void;
  allocateCredits(userId: UserId, amount: number): void;
}

interface ModerationAuthority {
  submitReport(report: ContentReport): ReportId;
  getVerdict(reportId: ReportId): Verdict;
  getCombatLog(area: AreaId, timeRange: TimeRange): CombatEvent[];
}
```

### V1 Services

**World Server** — Authoritative physics, chunk state management, action validation. Partitioned by ring segment and angular position.

**Asset Service** — Stores and serves glTF meshes, textures, audio. Content-addressed from day one (keyed by hash). V1 is S3.

**Attribution Registry** — Stores signed creation records. Maps content hashes to creator public keys, timestamps, and dependency lists. Provides provenance verification and adoption tracking.

**Identity Service** — Authentication, avatar definitions, plot ownership, reputation, credit balances. Generates a keypair for every user at registration.

**AI Service** — All generation requests. Text to TypeScript, text to asset, text to avatar, daemon behavior generation. Stateless. Takes prompt, world context, building code constraints, schema constraints. Returns validated output.

**Client** — Web-based. Three.js or Babylon.js. Open source. Connects to world server for current chunk, streams geometry, runs local prediction, sends actions to server for validation.

**Gateway** — Routes client connections to correct world server based on ring and angular position. Handles chunk handoff coordination.

---

## Decentralization Optionality

No decentralization timeline is committed to. The centralized version will be built well first. Decentralization decisions will be made when the platform has enough operational experience to understand the governance tradeoffs involved.

The following V1 architectural decisions preserve decentralization optionality:

- **Content-addressed asset storage.** Assets are keyed by hash, not by server location. Enables future migration to distributed storage (IPFS or similar) without changing any asset references.
- **Keypair generation at registration.** Every user has a public/private keypair from day one. These keys sign creation records and could support sovereign identity if the system decentralizes.
- **Signed creation records in the attribution registry.** Provenance is cryptographically verifiable, not dependent on a trusted central database.
- **Clean abstraction interfaces behind every service.** ChunkHost, OwnershipRegistry, BudgetAuthority, and ModerationAuthority are interfaces, not implementations. Swapping a centralized implementation for a distributed one requires no changes to anything above the interface.

---

## V1 Minimum Viable Scope

V1 proves two things: the AI creation experience is extraordinary, and building in a shared space with other people is meaningfully different from building alone.

### V1 Test

A non-technical person describes a building, sees it appear, walks down The Street, encounters another person's build, and initiates unprompted interaction with that person. If the shared space creates a social impulse that wouldn't exist in a single-player building tool, the core promise is validated.

### V1 Ships

- **One neighborhood, one ring.** Enough plots for the launch cohort of invited, hand-curated creators.
- **The AI creation pipeline at full quality.** Natural language to placed building. The universal building code and the launch neighborhood's building code enforced by the validator.
- **The staging environment.** Full design tools available to every creator.
- **Default avatars.** 4–6 clean, minimal starting options (Clints and Brandys).
- **Basic avatar movement and presence.** Walk the street, see other users.
- **Proximity text chat.** Spatial: you see messages from people near you.
- **Persistence.** Log out, log back in, your build is there, other people can see it.
- **The attribution registry.** Provenance tracked from day one.

### V1.1 Adds

- AI avatar customization (describe your appearance, AI generates it)
- Basic daemons (greeters, simple behaviors)

### V1.2 Adds

- Second ring, beginning of promotion/relegation
- Additional neighborhoods (community-proposed)
- Increased daemon complexity

### V1 Does Not Include

Multiple rings. Promotion/relegation. Combat. The teleport-out system. The ignore system. Advanced daemons. The monorail. The crowd pressure system. The jury moderation system. Event hosting. Cross-plot interactions. The governance framework (beyond platform-operator decisions). Voice audio. The overflow layer.

### V1 Launch Strategy

The launch cohort is hand-curated. The first users on the (only) ring ARE the quality floor. The AI creation tools must be polished enough that these invited creators produce work worth showing. First impressions are formed here. This is where screenshots come from and word of mouth begins.

---

## Open Decisions

### Design Decisions
- **Renderer**: Three.js vs. Babylon.js vs. PlayCanvas for V1 web client
- **3D Generation Service**: Which external model generation service to integrate for novel asset creation
- **Promotion/Relegation Count**: Fixed count vs. fixed percentage vs. bracketed scaling per ring boundary
- **Ring Count**: How many rings at maturity, and the expansion schedule
- **Plot Dimensions**: Specific footprint size for the universal plot constraint
- **Interstitial Governance**: Detailed rules for commons stewardship on outer rings
- **Combat Tuning**: Specific values for home ring advantage decay, defender bonus, cooldown escalation rates, lock-on wind-up duration
- **Jury Pool Size**: Minimum community size required to activate the jury-based moderation system
- **Default Daemon Capabilities**: Exact boundary between basic (all-ring) and advanced (inner-ring) daemon features
- **Composite Score Weights**: Specific weights for the primary triad and asset adoption modifier
- **Recency Decay Rate**: Exact exponential decay curve for the 128-day rolling average

### Deferred Topics
- **Revenue Model**: How the platform sustains itself. Who pays for infrastructure, especially disproportionate inner-ring investment.
- **Onboarding Flow**: What the first 10 minutes look like for a new user.
- **Social Features**: Friends list, messaging, finding people you know. Relationships aren't always spatial.
- **Information/Search System**: "Where are people? What's popular? What's new?" In-world discovery and world state queries.
- **Performance Targets**: Frame rate targets, latency budgets, concurrent user targets per chunk.
