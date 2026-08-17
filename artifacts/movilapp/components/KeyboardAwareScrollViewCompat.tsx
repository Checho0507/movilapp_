import React, { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, ScrollViewProps, Keyboard, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import {
  KeyboardAwareScrollView,
  KeyboardAwareScrollViewProps,
} from 'react-native-keyboard-controller';

// A small compatibility wrapper around the keyboard-aware scroll view used in the app.
// Enhancements added:
// - Restore scroll position to top when keyboard hides (prevents inputs staying scrolled up)
// - Cap automatic scrolling while keyboard is visible to avoid runaway upward shifts when
//   content grows (e.g., search results pushing layout). The cap is configurable via
//   `maxExtraScroll` (defaults to 240px).

type Props = KeyboardAwareScrollViewProps & ScrollViewProps & {
  maxExtraScroll?: number; // px to allow additional automatic scroll beyond base position
};

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = 'handled',
  maxExtraScroll = 240,
  ...props
}: Props) {
  const scrollRef = useRef<ScrollView | null>(null);
  const currentY = useRef(0);
  const baseY = useRef(0);
  const keyboardVisible = useRef(false);
  const clampTimeout = useRef<number | null>(null);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      keyboardVisible.current = true;
      // capture base scroll position when keyboard appears
      baseY.current = currentY.current;
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisible.current = false;
      // when keyboard hides, restore to original top position smoothly
      try {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      } catch (e) {
        // ignore
      }
    });

    return () => {
      showSub.remove();
      hideSub.remove();
      if (clampTimeout.current) {
        clearTimeout(clampTimeout.current);
      }
    };
  }, []);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    currentY.current = e.nativeEvent.contentOffset.y;
    // forward prop if provided
    if (props.onScroll) props.onScroll(e);
  }

  function onContentSizeChange() {
    // When content changes while keyboard is visible, clamp the scroll position so the
    // view doesn't drift upward unboundedly. Use a short timeout to let layout settle.
    if (!keyboardVisible.current) return;
    if (clampTimeout.current) clearTimeout(clampTimeout.current);
    clampTimeout.current = (setTimeout(() => {
      const maxAllowed = baseY.current + (maxExtraScroll ?? 240);
      if (currentY.current > maxAllowed) {
        try {
          scrollRef.current?.scrollTo({ y: maxAllowed, animated: true });
          currentY.current = maxAllowed;
        } catch (e) {
          // ignore
        }
      }
    }, 120) as unknown) as number;
  }

  if (Platform.OS === 'web') {
    return (
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        onScroll={onScroll}
        onContentSizeChange={onContentSizeChange}
        scrollEventThrottle={16}
        {...props}
      >
        {children}
      </ScrollView>
    );
  }

  // For native platforms use the keyboard-aware scroll view but still attach handlers
  // so we can clamp/restore behavior consistently across the app.
  return (
    <KeyboardAwareScrollView
      ref={scrollRef as any}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      onScroll={onScroll}
      onContentSizeChange={onContentSizeChange}
      scrollEventThrottle={16}
      extraScrollHeight={20}
      enableOnAndroid
      {...props}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
