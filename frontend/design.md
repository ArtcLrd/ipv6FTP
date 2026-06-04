# VoIPv6 Stitch Design Prompt

Use this document as the source prompt for Stitch when generating the first UI screen for the Expo mobile app.

## What To Select In Stitch Before Prompting

1. Click **Start with your design**.
2. Select **App**, not Web.
3. Select **Native mobile app** if Stitch asks for platform/output.
4. For style preset, start with **Carbon** for the first run because it fits the file-explorer/Discord direction while staying mobile-friendly.
5. Use **3 Flash** only if you want faster rough concepts. Use the highest quality/most detailed option available if Stitch lets you choose quality.
6. Upload or attach the VoIPv6 logo image before generating. Tell Stitch to use it as the app logo and not to redraw it.
7. Generate only the **main authenticated home page** first. Do not generate login, register, settings, or call screen yet.
8. After the first generation, ask Stitch for **three visual variations of the same home screen**, not three different products.

## Base Product Context

Design a native Expo / React Native mobile app home screen for a secure VoIP calling app named **VoIPv6**. The app lets logged-in users search for other users, maintain a contact list, see connection status, and start a voice call or secure connection from a contact row.

The app should feel familiar to users of Android Phone, Google Phone, WhatsApp, file explorers, and Discord, but it must not copy those apps. Borrow only the interaction patterns: searchable lists, clear presence states, bottom navigation, quick call actions, obvious account identity, predictable spacing, and self-explanatory controls.

The output should be a high-fidelity mobile UI concept that can later be implemented in Expo React Native.

## Main Screen Requirements

Create the authenticated home screen only.

The screen must include:

- Header with the VoIPv6 logo, the title **VoIPv6**, and logged-in user details.
- Logged-in user details should include an avatar or initial, username, small online/security status, and a subtle account/menu button.
- A search field for finding users or contacts.
- A main contact list inspired by a file explorer/sidebar and Discord user list.
- Each contact row should show avatar/initial, display name, status, connection indicator, IPv6 or network hint, and a primary call/connect action.
- A clear call/connect control on each contact row using a phone or link icon.
- Empty/list loading states should be visually planned, even if not shown as the primary state.
- A footer bottom navigation menu with 4 items: Contacts, Calls, Add/Search, Settings.
- The Contacts tab should be active.
- Include a floating or prominent secondary action for adding/searching contacts if it fits the layout.
- The screen should communicate the workflow by itself without a tutorial wizard.

The UI should show sample data:

- Logged-in user: `Om`, status `Online`, security/network hint `IPv6 ready`
- Contacts:
  - `Aarav`, `Online`, `Direct IPv6`, action `Call`
  - `Mira`, `Away`, `Relay available`, action `Connect`
  - `Dev Node`, `Online`, `Local network`, action `Call`
  - `Sam`, `Offline`, `Last seen recently`, action disabled or muted

## Interaction And UX Direction

The interface must be self-flowing:

- Users should immediately understand that the top area is their account and app identity.
- Search should look like the natural way to add or find contacts.
- Contact rows should make the next action obvious without requiring explanation.
- Presence colors must be meaningful but not the only signal; also use labels/icons.
- Bottom navigation should make the app structure obvious.
- Avoid tutorial cards, onboarding banners, long instructions, or explanatory blocks.
- Use short labels and familiar icons.
- Make the screen usable with one hand on mobile.

## Responsiveness And Accessibility

Design for all common mobile sizes:

- Small Android phones around 360px wide.
- Standard phones around 390-430px wide.
- Large phones and foldables.
- Safe areas, notches, and Android navigation bars.
- Portrait first, but the layout should not break in wider screens.

Accessibility requirements:

- High contrast in both dark and light mode.
- Text must stay readable on any background.
- Font should be a clean system-style sans serif that supports many languages well, similar to Inter, Roboto, SF Pro, or Noto Sans.
- Do not use tiny text for important actions.
- Minimum touch target should feel like 44px or larger.
- Contact rows must not rely only on color to show online/offline state.
- Avoid cramped icon-only controls unless the meaning is obvious.

## Visual Style Requirements

The style should be modern, stylish, and fresh, but the focus is product usability rather than decoration.

Use:

- A dark-mode-friendly visual system with a clear light-mode equivalent.
- A color palette that feels modern and unique, not a generic blue/purple gradient app.
- Layered surfaces like file explorers and Discord: app background, header surface, list surface, selected navigation state.
- Subtle depth, borders, dividers, and state colors.
- Crisp icons, clear spacing, and simple shapes.
- Contact rows that feel tappable and scannable.

Avoid:

- Marketing landing page layout.
- Large hero sections.
- Tutorial wizard UI.
- Heavy gradients as the main identity.
- Copying WhatsApp, Discord, Android Phone, or Google Phone exactly.
- Overly playful or decorative visuals.
- Crowded cards inside cards.
- Text overlapping controls.

## Generate Three Iterations

Generate three distinct visual variations of the same VoIPv6 home screen. Keep the same app structure and content in all three so they can be compared fairly.

### Iteration 1: Carbon Explorer

Direction: File explorer plus Discord-style contact list.

Use a graphite/charcoal dark theme with soft cyan and green connection accents. The layout should feel technical, secure, and organized. Header is compact and professional. Contact list uses clean rows with subtle dividers, status chips, and right-aligned call/connect icons. Bottom navigation feels like a native Android app with a selected Contacts state.

Mood: reliable, secure, calm, developer-friendly.

### Iteration 2: Signal Glass

Direction: Modern communication app with soft translucent surfaces.

Use a deep ink background with cool teal, mint, and warm amber accents. Surfaces may feel slightly glassy or frosted, but must remain readable and implementable in React Native. Contact rows can have gentle grouped-list styling like a refined phone/contact app. Search is prominent and inviting. Call/connect actions should feel immediate and reachable.

Mood: premium, fresh, personal, confident.

### Iteration 3: Light Mesh

Direction: Light-mode-first system UI that also has an obvious dark-mode partner.

Use an off-white or very pale cool background, dark readable text, restrained navy/green/teal accents, and clean Android-style navigation. This should feel friendly and familiar to non-technical users while still carrying the VoIPv6 identity. Avoid beige, plain gray, and generic blue-only styling. The logo and title should feel integrated, not pasted on.

Mood: approachable, fast, clean, everyday-use friendly.

## Stitch Prompt To Paste

Create three high-fidelity native mobile app UI variations for the authenticated home screen of an Expo React Native app named **VoIPv6**. Use the attached lightning logo as the app logo exactly as provided, and place the title **VoIPv6** near it in the header.

VoIPv6 is a secure VoIP calling app focused on IPv6-ready contact calling. The screen should show the logged-in user's identity, a searchable contact list, quick call/connect actions, and a footer navigation menu. Generate only the main home page for now, not login, onboarding, settings, or call screens.

The UI should feel like a modern blend of file explorer organization, Discord contact presence, Android Phone contact patterns, Google Phone clarity, and WhatsApp-style approachable communication flow. Do not copy any of those apps directly. Borrow only the familiar flows: searchable list, presence indicators, easy call actions, bottom navigation, and clear account identity.

Required content:

- Header with attached logo, **VoIPv6** title, and logged-in user details.
- Logged-in user: avatar or initial, username **Om**, status **Online**, network/security hint **IPv6 ready**, and a subtle menu/account button.
- Search field for contacts and users.
- Main contact list with rows for:
  - **Aarav**, Online, Direct IPv6, primary action Call
  - **Mira**, Away, Relay available, primary action Connect
  - **Dev Node**, Online, Local network, primary action Call
  - **Sam**, Offline, Last seen recently, muted/disabled action
- Each row should include avatar/initial, name, status label, connection/network hint, meaningful presence indicator, and right-aligned call/connect icon button.
- Footer bottom navigation with 4 tabs: Contacts, Calls, Add/Search, Settings. Contacts is active.
- Include an add/search contact affordance if it fits naturally.

UX requirements:

- The screen must explain itself through layout and labels, without tutorial text or onboarding wizard.
- Make the next action obvious: search to find users, tap a contact to view details, tap call/connect to start communication.
- Keep the screen one-hand friendly and highly scannable.
- Use familiar mobile interaction patterns without making the app look generic.
- Plan for loading and empty states visually, but keep the main mockup populated with the sample contacts.

Responsive and accessibility requirements:

- Must work on small Android phones, standard phones, large phones, and foldables.
- Respect safe areas, notches, Android navigation bars, and variable status bar heights.
- Use minimum 44px touch targets for primary controls.
- Text must never overlap icons or controls.
- Use a readable multilingual-friendly system font style similar to Inter, Roboto, SF Pro, or Noto Sans.
- High contrast for both light and dark mode.
- Presence should not rely on color alone; combine color with labels or icons.

Create exactly three variations with the same information architecture:

1. **Carbon Explorer**: graphite/charcoal dark theme, cyan and green accents, subtle file-explorer/Discord structure, technical and secure feeling.
2. **Signal Glass**: deep ink theme with teal, mint, and amber accents, refined translucent surfaces, premium communication app feeling while staying practical for React Native.
3. **Light Mesh**: light-mode-first design with a strong dark-mode partner, off-white or pale cool background, restrained navy/green/teal accents, friendly Android-like clarity.

Do not create a landing page. Do not include long instructional text. Do not use heavy gradients, generic purple-blue themes, or decorative blobs. The design should be modern and stylish, but product usability must be the priority.

## After Stitch Generates The Three Options

1. Compare the three options by workflow first, not beauty.
2. Pick the option where search, contact status, and call/connect actions are clearest in the first 3 seconds.
3. Check whether the bottom navigation labels still fit on a small phone.
4. Check whether the header shows logo, app title, and user identity without feeling crowded.
5. Ask Stitch for a dark and light mode version of the selected option.
6. Then generate the next screens in this order:
   - Contact details
   - Active call
   - Incoming call
   - Add/search user
   - Settings
   - Login/register refresh

## Follow-Up Prompt After Choosing One Direction

Use the selected VoIPv6 home screen direction as the design system. Generate a complete responsive dark and light mode version of this same home screen. Preserve the information architecture, logo placement, contact row behavior, bottom navigation, typography, spacing scale, and icon style. Improve only clarity, accessibility, and consistency.
