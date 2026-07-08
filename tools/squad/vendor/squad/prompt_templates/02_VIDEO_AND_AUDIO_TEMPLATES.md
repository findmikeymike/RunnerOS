# Video & Audio Prompt Templates

Templates for video generation (image-to-video, text-to-video) and voiceover/audio production.

---

## IMAGE-TO-VIDEO TEMPLATES (Animate a Still)

### VID-I2V-001: Slow Reveal / Camera Push
**Use:** Hero product reveal, dramatic intro  
**Style families:** BRUTALIST, EDITORIAL, PREMIUM  
**Model:** Kling 2.5 Turbo (budget) or Kling 3.0 (quality)

```
video_prompt: >
  Slow camera push-in toward {subject}. Subtle atmospheric movement: 
  {atmospheric_detail}. {lighting_shift}. 
  Cinematic, controlled, deliberate. 5-8 seconds.

examples:
  - input_image: "hero tshirt flat lay on concrete"
    prompt: "Slow camera push-in toward the tshirt. Subtle atmospheric dust particles 
    floating in the harsh directional light. Light intensifies slightly. 
    Cinematic, controlled, deliberate. 5 seconds."
    
  - input_image: "phone showing app on marble surface"
    prompt: "Gentle camera push-in toward the phone screen. Soft ambient light shifts 
    warm to cool. Subtle reflection moves across the screen surface. 
    Premium, controlled, 6 seconds."

motion_intensity: low
camera: push-in, slow zoom
```

### VID-I2V-002: Living Moment
**Use:** Lifestyle shot, social content, product-in-use  
**Style families:** UGC, ART CULTURE (Frank Ocean), PREMIUM  
**Model:** Kling 3.0 (best human motion)

```
video_prompt: >
  Gentle natural movement: {person_action}. 
  {environmental_motion}. {natural_life_details}.
  Feels like a captured moment, not generated. {duration}.

examples:
  - input_image: "person wearing tshirt at cafe"
    prompt: "Person takes a sip of coffee, slight smile, looks toward window. 
    Steam rises from cup. Warm light shifts. 
    Captured moment, not posed. 5 seconds."
    
  - input_image: "hand holding phone with app"
    prompt: "Thumb gently scrolls the app screen. Background cafe slightly out of focus 
    with people moving. Natural, authentic. 4 seconds."

motion_intensity: low-medium
camera: static or very gentle drift
```

### VID-I2V-003: Energy Burst
**Use:** Hype content, music promo, merch drop announcement  
**Style families:** PSYCHEDELIC, ART CULTURE, BRUTALIST  
**Model:** Kling 3.0 or Veo 3.1 (for complex motion)

```
video_prompt: >
  Dynamic energy: {explosion_of_action}. 
  {visual_effects}. {camera_movement}.
  Fast cuts feel. High intensity. {duration}.

examples:
  - input_image: "album artwork with psychedelic swirls"
    prompt: "Colors begin swirling and pulsing with increasing intensity, 
    patterns kaleidoscope outward, prismatic light bursts from center. 
    Camera slowly rotates. Building energy. 8 seconds."
    
  - input_image: "merch collection flat lay"
    prompt: "Items begin vibrating, then explode outward into the air, 
    each piece spinning in slow motion against a dark void. 
    Dramatic lighting catches each item. 6 seconds."

motion_intensity: high
camera: dynamic — rotation, zoom, or shake
```

### VID-I2V-004: Product Transform
**Use:** Before/after, feature reveal, upgrade announcement  
**Style families:** EDITORIAL, PREMIUM, PSYCHEDELIC  
**Model:** Kling 3.0

```
video_prompt: >
  Transformation sequence: {start_state} smoothly morphs into {end_state}.
  {transition_style}. {lighting_evolution}.
  Satisfying, seamless, share-worthy. {duration}.

examples:
  - input_image: "plain tshirt on white background"
    prompt: "Plain white tshirt smoothly transforms as the graphic design 
    bleeds onto the fabric like ink in water, colors spreading 
    organically until the full design is revealed. 6 seconds."

motion_intensity: medium
camera: static (focus on the transform)
```

---

## TEXT-TO-VIDEO TEMPLATES (Generate from Scratch)

### VID-T2V-001: UGC Testimonial Scene
**Use:** TikTok/Reel ad, testimonial  
**Style families:** UGC  
**Model:** Kling 3.0 (best human generation)

```
video_prompt: >
  UGC-style selfie video: {person_description} in {casual_setting}, 
  {speaking_to_camera_action}. {genuine_emotion}.
  iPhone front camera quality, natural lighting, vertical 9:16.
  Ring light catchlight in eyes. {duration}.

examples:
  - "Young woman in her mid-20s in a well-lit bedroom, excitedly showing something 
    on her phone to the camera, genuine surprised expression transitioning to a smile. 
    iPhone selfie quality, ring light, vertical. 8 seconds."

note: "For actual talking heads with lip-sync, use HeyGen (v3) instead of generation models"
```

### VID-T2V-002: Cinematic B-Roll
**Use:** Ad filler, website background, mood content  
**Style families:** EDITORIAL, PREMIUM, BRUTALIST  
**Model:** Veo 3.1 (best motion quality) or Kling 2.5 Turbo (budget)

```
video_prompt: >
  Cinematic b-roll: {scene_description}. 
  {camera_movement}. {lighting_and_atmosphere}.
  No people required. {mood}. Widescreen 16:9. {duration}.

examples:
  - "Cinematic b-roll: slow aerial drift over brutalist concrete building at sunset, 
    warm golden light hitting geometric surfaces, long shadows. 
    Atmospheric haze. Contemplative. Widescreen. 8 seconds."
    
  - "Cinematic b-roll: close-up tracking shot along a row of hanging tshirts 
    in a sunlit studio, fabric swaying gently in breeze, 
    warm premium lighting. Intimate. 6 seconds."

camera: slow drift, tracking, or aerial
motion_intensity: low
```

### VID-T2V-003: Abstract/Mood Loop
**Use:** Website background, social post, visualizer  
**Style families:** PSYCHEDELIC, BRUTALIST, ART CULTURE  
**Model:** Kling 2.5 Turbo (budget, simpler motion)

```
video_prompt: >
  Abstract loop: {visual_description}. 
  Continuous, hypnotic motion. {color_palette}.
  Perfect loop potential. {duration}.

examples:
  - "Abstract loop: liquid chrome surface reflecting neon colors, 
    slow undulating waves, iridescent highlights shifting. 
    Psychedelic palette. Hypnotic. 5 seconds."
    
  - "Abstract loop: concrete texture with water slowly trickling 
    through cracks, monochrome, minimal movement. 
    Brutalist meditation. 6 seconds."

camera: static
motion_intensity: low (loops need subtlety)
```

---

## VOICEOVER SCRIPT TEMPLATES

### VO-001: Product Hype (Short)
**Use:** Reel/TikTok voiceover, 15-30 seconds  
**Voice style:** Energetic, confident, conversational  
**ElevenLabs voice:** Pick a young, energetic voice — not announcer, not corporate

```
script_template: >
  [Hook — 3 seconds, stop the scroll]
  {hook_line}
  
  [Value — 5-8 seconds]  
  {what_it_does_and_why_you_care}
  
  [Proof — 3-5 seconds]
  {social_proof_or_result}
  
  [CTA — 3 seconds]
  {call_to_action}

examples:
  - hook: "Okay but why did nobody tell me about this"
    value: "This app literally does {thing} in like two taps — I used to spend 
    an hour on this"
    proof: "I've been using it for three weeks and honestly I'm mad I didn't find it sooner"
    cta: "Link in bio, don't sleep on it"

voice_direction: "Speak like you're telling your best friend about something cool you found. 
Not selling. Sharing. Pace: fast but clear. Energy: genuine excitement, not hype-beast."
```

### VO-002: Cinematic Narrator
**Use:** Brand video, longer ad, website hero video  
**Voice style:** Deep, measured, authoritative but warm  
**ElevenLabs voice:** Deep male or confident female — think Apple keynote energy

```
script_template: >
  [Opening — set the world, 5-8 seconds]
  {atmospheric_opening_line}
  
  [Tension — the problem or desire, 5-8 seconds]
  {tension_line}
  
  [Resolution — the product enters, 5-8 seconds]
  {product_introduction}
  
  [Closing — brand moment, 3-5 seconds]
  {brand_tagline_or_feeling}

examples:
  - opening: "There's a moment. Right before you hit publish. When everything feels possible."
    tension: "But the tools weren't built for people like us."
    resolution: "Until now. {Product} doesn't just work. It feels like it was made for you."
    closing: "{Brand}. Made different."

voice_direction: "Measured, deliberate pace. Let the pauses breathe. 
Not whisper — confident quiet. Think 'late night radio host who also reads philosophy.' 
No rush. Every word lands."
```

### VO-003: Streetwear/Culture Drop
**Use:** Merch announcement, collection drop  
**Voice style:** Cool, minimal, almost bored confidence  
**ElevenLabs voice:** Low-key, slightly raspy, unbothered

```
script_template: >
  [Drop announcement — 3-5 seconds]
  {drop_headline}
  
  [Details — 5 seconds, keep it sparse]
  {what_when_where}
  
  [Closing — 3 seconds]
  {urgency_or_attitude}

examples:
  - headline: "New collection. {Name}."
    details: "{Date}. Limited run. {Number} pieces."
    closing: "If you know, you know."

voice_direction: "Minimum words, maximum cool. Like you're letting people in on a secret 
you don't care if they miss. Pace: slow. Energy: unbothered confidence."
```

### VO-004: Music Release Teaser
**Use:** Single/album announcement, listening party promo  
**Voice style:** Matches the music's energy  
**ElevenLabs voice:** Match to track mood

```
script_template: >
  [Atmospheric intro — 3-5 seconds, voice emerges from music]
  {cryptic_or_poetic_opening}
  
  [Reveal — 3 seconds]
  {track_or_album_name}. {release_date_or_action}.

examples:
  - opening: "You weren't supposed to hear this yet."
    reveal: "'{Track Name}.' Everywhere Friday."
    
  - opening: "Three years. Fourteen tracks. One frequency."
    reveal: "'{Album Name}.' {Date}."

voice_direction: "Voice should feel like it's part of the music, not talking over it. 
Whisper-to-speak dynamic. Intimate. Like a voice memo that was never meant to be public."
```

---

## AUDIO MIXING TEMPLATES

### AUD-MIX-001: Voice Over Music (Standard)
```
mixing_spec:
  voice_volume: 0dB (reference)
  music_volume: -15dB to -18dB (under voice)
  music_duck: true (auto-reduce music during speech)
  duck_amount: -6dB additional during speech
  fade_in: 1.5s on music
  fade_out: 2.0s on music
  voice_delay: 1.5s (let music establish before voice enters)
```

### AUD-MIX-002: Music-Forward (Voice as Accent)
```
mixing_spec:
  voice_volume: -3dB
  music_volume: -6dB (music is prominent)
  music_duck: false
  voice_reverb: subtle room reverb
  crossfade: 0.5s between voice segments
  note: "Voice is part of the texture, not the star"
```

### AUD-MIX-003: UGC Raw (No Music)
```
mixing_spec:
  voice_volume: 0dB
  music_volume: null (no background music)
  ambient_noise: subtle room tone for authenticity
  compression: light (preserve natural dynamics)
  note: "Should sound like a voice memo or screen recording"
```

---

## CAPTION/SUBTITLE STYLE TEMPLATES

### CAP-001: Bold Impact (TikTok/Reels)
```
style:
  font: Montserrat Black or similar heavy sans-serif
  size: large (fills ~40% of width)
  color: white with black outline
  position: center of frame
  animation: word-by-word pop-in
  highlight_color: accent color on key words
  case: ALL CAPS for emphasis words, sentence case otherwise
```

### CAP-002: Minimal Clean (Editorial)
```
style:
  font: Helvetica Neue Light or similar
  size: small-medium (subtle)
  color: white, 85% opacity
  position: lower third
  animation: fade in/out by phrase
  background: semi-transparent dark bar
  case: sentence case
```

### CAP-003: Brutalist Type
```
style:
  font: Monument Extended or similar brutalist sans
  size: medium
  color: white on black bar or raw on footage
  position: varies (can be anywhere — part of the design)
  animation: hard cut by phrase (no smooth transitions)
  case: ALL CAPS always
```
