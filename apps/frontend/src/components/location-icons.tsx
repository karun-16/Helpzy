import { View } from 'react-native';

/**
 * The two glyphs the location picker needs, drawn with plain views.
 *
 * The project has no icon dependency, and `time-picker-field` already sets the
 * precedent of drawing its clock face from `View`s so it needs no new package and
 * renders identically under Expo web and native. These follow it.
 *
 * This also removes a real defect rather than only restyling: the picker used to
 * rely on a raw emoji for its pin, and the source had been stored with the
 * characters double-encoded, so the header rendered `ðŸ“` instead of a pin. A
 * shape drawn from geometry cannot be corrupted by an encoding mistake, cannot
 * fall back to a monochrome glyph on a device without the emoji font, and cannot
 * shift colour with the system emoji style.
 */

/** A location pin: a ring above a small triangle that points down. */
export function LocationPin({ size = 16, color }: { size?: number; color: string }) {
  const ring = size;
  const tip = Math.max(4, Math.round(size * 0.42));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ width: size, height: size + tip, alignItems: 'center' }}
    >
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: Math.max(1.5, size * 0.13),
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* The dot inside the ring is what makes it read as "here" rather than
            as a plain circle. */}
        <View
          style={{
            width: Math.max(2, size * 0.22),
            height: Math.max(2, size * 0.22),
            borderRadius: size,
            backgroundColor: color,
          }}
        />
      </View>
      <View
        style={{
          width: 0,
          height: 0,
          marginTop: -1,
          borderLeftWidth: tip / 2,
          borderRightWidth: tip / 2,
          borderTopWidth: tip,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: color,
        }}
      />
    </View>
  );
}

/** A magnifier: a ring with a handle. */
export function SearchGlyph({ size = 16, color }: { size?: number; color: string }) {
  const ring = size;
  const handle = Math.max(3, Math.round(size * 0.4));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ width: ring, height: ring, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: Math.max(1.5, size * 0.13),
          borderColor: color,
          transform: [{ translateX: -handle * 0.28 }, { translateY: -handle * 0.28 }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: handle,
          height: Math.max(1.5, size * 0.13),
          borderRadius: size,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }, { translateX: handle * 0.42 }],
        }}
      />
    </View>
  );
}

/** A small down-pointing caret, used for the district disclosure rows. */
export function Caret({ size = 14, color, open }: { size?: number; color: string; open: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ rotate: open ? '180deg' : '0deg' }],
      }}
    >
      <View
        style={{
          width: size * 0.6,
          height: size * 0.6,
          borderRightWidth: 2,
          borderBottomWidth: 2,
          borderColor: color,
          transform: [{ rotate: '45deg' }, { translateY: -size * 0.12 }],
        }}
      />
    </View>
  );
}
