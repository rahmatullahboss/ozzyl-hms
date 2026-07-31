## Design System: OzzyLife

### Pattern
- **Name:** Social Proof-Focused
- **CTA Placement:** Above fold
- **Sections:** Hero > Features > CTA

### Style
- **Name:** Neumorphism
- **Keywords:** Soft UI, embossed, debossed, convex, concave, light source, subtle depth, rounded (12-16px), monochromatic
- **Best For:** Health/wellness apps, meditation platforms, fitness trackers, minimal interaction UIs
- **Performance:** ⚡ Good | **Accessibility:** ⚠ Low contrast

### Colors
| Role | Hex |
|------|-----|
| Primary | #0891B2 |
| Secondary | #22D3EE |
| CTA | #059669 |
| Background | #ECFEFF |
| Text | #164E63 |

*Notes: Calm blue + health green + trust*

### Typography
- **Heading:** Lora
- **Body:** Raleway
- **Mood:** calm, wellness, health, relaxing, natural, organic
- **Best For:** Health apps, wellness, spa, meditation, yoga, organic brands
- **Google Fonts:** https://fonts.google.com/share?selection.family=Lora:wght@400;500;600;700|Raleway:wght@300;400;500;600;700
- **CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600;700&family=Raleway:wght@300;400;500;600;700&display=swap');
```

### Key Effects
Soft box-shadow (multiple: -5px -5px 15px, 5px 5px 15px), smooth press (150ms), inner subtle shadow

### Avoid (Anti-patterns)
- Bright neon colors
- Motion-heavy animations
- AI purple/pink gradients

### Pre-Delivery Checklist
- [ ] No emojis as icons (use SVG: Heroicons/Lucide)
- [ ] cursor-pointer on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard nav
- [ ] prefers-reduced-motion respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px

