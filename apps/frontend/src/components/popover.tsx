import { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  type LayoutRectangle,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

/**
 * An anchored popover.
 *
 * The dropdown problems this replaces were all consequences of rendering the
 * menu inside the normal flow: it pushed the page around, it was clipped by
 * whatever ancestor constrained it, and on a phone it fell off the bottom of the
 * screen. This renders through a transparent `Modal`, so it is never clipped by
 * an ancestor, and positions itself from the anchor's measured window rectangle
 * rather than from CSS offsets.
 *
 * It measures rather than guessing: if there is not enough room below, it flips
 * above the anchor, and it clamps horizontally so the panel always stays fully
 * on screen.
 */
export function Popover({
  visible,
  onClose,
  anchorRef,
  width = 320,
  maxHeight = 420,
  label,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<View | null>;
  width?: number;
  maxHeight?: number;
  /** Describes the popover for assistive technology. */
  label: string;
  children: React.ReactNode;
}) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [anchor, setAnchor] = useState<LayoutRectangle | null>(null);

  const measure = useCallback(() => {
    const node = anchorRef.current as unknown as {
      measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
    } | null;
    if (!node?.measureInWindow) return;
    node.measureInWindow((x, y, w, h) => {
      setAnchor({ x, y, width: w, height: h });
    });
  }, [anchorRef]);

  /*
   * Measured on open so the panel is never painted at a stale position, and
   * again on resize so rotating a phone or resizing a window re-clamps it.
   *
   * A stale rectangle is harmless when closed - the component renders `null`
   * anyway - so nothing is reset here; resetting it would be a synchronous
   * setState in an effect, which is exactly the cascading-render pattern this
   * component is meant to avoid.
   */
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(measure, 0);
    return () => clearTimeout(id);
  }, [visible, measure]);

  if (!visible) return null;

  const gap = 8;
  const margin = 8;
  const panelWidth = Math.min(width, screenWidth - margin * 2);

  // Until the anchor has been measured, render the overlay only. Painting the
  // panel first would flash it in the wrong place on the way to its position.
  let position: { left: number; top: number } | null = null;
  if (anchor) {
    const spaceBelow = screenHeight - (anchor.y + anchor.height) - gap - margin;
    const spaceAbove = anchor.y - gap - margin;
    const openAbove = spaceBelow < Math.min(maxHeight, 260) && spaceAbove > spaceBelow;

    const top = openAbove
      ? Math.max(margin, anchor.y - gap - Math.min(maxHeight, spaceAbove))
      : Math.min(
          anchor.y + anchor.height + gap,
          Math.max(margin, screenHeight - margin - Math.min(maxHeight, spaceBelow)),
        );

    const desiredLeft = anchor.x + anchor.width - panelWidth;
    const left = Math.min(
      Math.max(margin, desiredLeft),
      Math.max(margin, screenWidth - panelWidth - margin),
    );

    position = { left, top };
  }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.layer}>
        {/*
          A full-bleed press target behind the panel closes on an outside click.
          `onPress` rather than `onPressIn` so a drag that started on the panel
          does not dismiss it when it ends.
        */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        {position ? (
          <View
            accessibilityLabel={label}
            className="overflow-hidden border border-hairline-strong bg-surface"
            style={[
              styles.panel,
              {
                left: position.left,
                top: position.top,
                width: panelWidth,
                maxHeight,
              },
            ]}
          >
            {children}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1 },
  panel: {
    position: 'absolute',
    borderRadius: 14,
    padding: 12,
    // The elevated layer: above page content, and its own shadow marks it as
    // floating rather than part of the page. Colours and the border come from
    // `className` so the panel follows the theme; painting them here would pin
    // it to white and leave dark-mode text unreadable on it.
    zIndex: 1000,
    elevation: 12,
    shadowColor: '#0f172a',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
});

/** Shared popover chrome, so every popover in the app looks the same. */
export function PopoverHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View className="mb-2 flex-row items-center justify-between gap-3">
      <Text className="text-sm font-bold text-primary">{title}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        className="min-h-8 min-w-8 items-center justify-center rounded-md active:bg-surface-muted dark:active:bg-slate-700"
      >
        <Text className="text-base font-bold text-muted">×</Text>
      </Pressable>
    </View>
  );
}
