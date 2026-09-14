# Product Requirements Document (PRD)

## 1. Overview & Objective

The **Memory Jar** application is a low-friction web application engineered to anchor users in the present moment by eliminating archival overhead. By reducing the capture process to a single-tap action and abstracting photographs into tinted, volumetric 3D pastel "marbles," the system prevents rumination, decision fatigue, and the impulse to curate past events.

---

## 2. Core Principles

* **Zero Decision Fatigue:** Absolute removal of tagging, captioning, folder selection, and up-front naming.
* **Present-Moment Anchoring:** The default view is strictly the active vessel. Retrospective browsing is sequestered into a secondary space.
* **Singularity of Context:** Only one unsealed jar exists at any given time to eliminate categorization overhead.
* **Deliberate Retrospection:** Revisiting past memories is an intentional, opt-in activity isolated to the Shelves interface.
* **Stylized 3D-Pastel Aesthetic:** Illustrated cel-shaded glass with clean outlines, volumetric lighting, and soft pastel hues to evoke comfort without visual clutter.

---

## 3. User Flow & State Architecture

| Interface State | Trigger / User Action | System State Transition | Visual Feedback |
| :--- | :--- | :--- | :--- |
| **Launch (Default)** | Open application URL | Mounts active unsealed jar from local storage. | Illustrated 3D jar rests on a warm tabletop with cast drop shadow; existing marbles settle inside. |
| **Capture Initiation**| Tap "Add a memory" CTA | Triggers native OS file picker (`capture="environment"` / photo roll). | Screen remains static; native system picker opens. |
| **Ingestion** | Image blob selected | Generates 3D-orb marble element. Inserts into jar array. | Marble drops down into the jar with a soft, gentle bounce and settles into the resting pile. |
| **Inspect (Active Jar)**| Tap marble in active jar | Suspends ambient idle state; opens inspect modal over target coordinate. | Marble scales forward toward the screen, de-warping into a crisp, flat 2D photo card. |
| **Seal Jar** | Tap "Close this jar" | Prompts optional title (default placeholder: Date Range). Writes sealed flag to DB. | Pastel lid screws shut; jar slides off-screen to the Shelf. A fresh, empty jar instance mounts immediately. |
| **Navigate to Archive**| Swipe left or tap subtle shelf icon | Transitions routing from `/` to `/shelves`. | Soft horizontal pan revealing a pastel wooden shelving display of closed jars. |
| **Inspect (Archive)** | Tap sealed jar $\rightarrow$ Tap marble | Opens read-only jar contents $\rightarrow$ triggers inspect modal. | Same inspect de-warping modal; editing/adding disabled. |
| **Random Draw** | Tap "Draw a memory" on `/shelves` | Executes random read across all sealed marble records. | A random 3D marble floats up to the center of the viewport and de-warps into its photo card. |

---

## 4. Functional Specifications

### 4.1 Current Jar (Home View)
* **Root Route (`/`):** Displays exclusively the active jar, its accumulated marbles, and the primary capture trigger.
* **The Jar Container:**
  * Rendered as an illustrated, volumetric mason jar matching the reference design: a defined cylindrical body, an elliptical neck and base, bold clean outline contours, and high-gloss specular reflections.
  * Lid rendered in a contrasting soft pastel tone (e.g., blush pink/coral) that remains open/off while active and screws on upon sealing.
* **Primary CTA:** A single, rounded pastel button reading "Add a memory".
* **No Cold-Start Forms:** When initialized for the first time—or immediately after a jar is sealed—an untitled, open jar instance is instantly active.
* **Lifecycle Action:** A secondary, subdued control ("Close this jar") allows sealing the current container. 
  * If the input is dismissed or left blank, the system automatically assigns the active date span (e.g., *Oct 12 – Nov 3*).

### 4.2 Photo Capture & Ingestion
* **Bypass Pattern:** Completely bypasses cropping, photo filtering, metadata tagging, or caption prompts.
* **Volumetric Marble Generation:**
  * Masks the uploaded photo to a circle with a radial convex distortion.
  * Overlays a glossy curved specular reflection and an ambient shadow rim to yield an illustrated 3D marble look.
  * Tints the marble with a soft pastel hue derived from the photo’s dominant tone.
* **Stacking Behavior:** Marbles stack naturally inside the cylindrical jar using lightweight 2D rigid-body boundaries (or pre-calculated stacked slot physics).

### 4.3 Inspect Mode
* **Interaction:** Single tap on any marble inside an active or sealed jar.
* **Behavior:** Lifts the selected marble to the foreground; the sphere rotates forward and smoothly de-warps its distorted image into a flat photo card displaying the capture date.
* **Dismissal:** Tapping outside the photo card smoothly morphs the card back into its 3D spherical form and returns it to the jar.

### 4.4 The Shelves (Archive View)
* **Route (`/shelves`):** Hidden behind an unobtrusive icon or edge-swipe gesture.
* **Display:** A multi-tier pastel shelf displaying closed jars (lids screwed shut) labeled with their assigned titles or date stamps.
* **Immutability:** Sealed jars are strictly read-only.
* **Random Memory Retrieval ("Draw a Memory"):**
  * **Element:** A dedicated tactile button or small ceramic catchall dish on the shelf screen.
  * **Logic:** Pulls a random item from the index of all sealed memory blobs:
    $$\text{Index} = \lfloor \text{random}() \times N_{\text{sealed}} \rfloor$$
  * If $N_{\text{sealed}} = 0$, the control gracefully disables with a subdued label.
  * Launches the retrieved memory directly into the Inspect Mode modal.

---

## 5. UI/UX & Aesthetic Direction

### Visual Design Tokens
* **Aesthetic Style:** Illustrated 3D / Cel-Shaded Glass. Clean, weighted ink outlines (`#1C1B1F` or `#2D2A32` at 1.5–2px width), flat pastel base tones, and bold, crisp specular light reflections.
* **Color Palette:**
  * Glass Body: Translucent Sky Blue / Ice Blue (`#DDF3FA` with 60–75% opacity)
  * Jar Lid & Accents: Pastel Coral / Dusty Rose (`#F79FA8` base, `#D66E7A` shadow rim)
  * Background Split: Two-tone pastel room aesthetic (Wall: Soft Powder Pink `#FCE8EB`, Desk/Surface: Muted Cream `#F2EAE1`)
  * Marble Accents: Soft Washed Pastels (Mint `#C5E8D8`, Buttercup `#FFF0C2`, Lavender `#E2D9F3`, Peach `#FFDAC1`)
  * Specular Highlights: Pure White (`#FFFFFF` at 85–95% opacity)
  * Ground Shadow: Translucent Muted Mauve/Slate (`#6D5D6E` with 30% opacity)
* **Typography:** Rounded humanist sans-serif for UI buttons (e.g., *Nunito*, *Quicksand*) paired with an airy, lightweight serif for jar date labels.
* **Motion & Physics:**
  * Marbles enter from the neck with a gentle vertical drop and a low-velocity, soft spring settle.
  * Inspect de-warping runs at a calm 0.4s ease: `cubic-bezier(0.16, 1, 0.3, 1)`.

---

## 6. Technical Architecture

### 6.1 Layered Jar & 3D Marble Rendering Strategy
To maintain the illustrated 3D look with maximum performance on mobile browsers, the jar utilizes a composite layered canvas/DOM structure rather than a resource-heavy raytraced 3D scene: