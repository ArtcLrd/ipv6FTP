import React, { useRef, useEffect } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Text,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Theme } from "../theme";

// Individual tab item — hooks must be at component top level, not inside .map()
function TabItem({
  route,
  index,
  isFocused,
  options,
  navigation,
}: {
  route: any;
  index: number;
  isFocused: boolean;
  options: any;
  navigation: any;
}) {
  // Unselected = 1.0 (flat/neutral). Selected = 0.95 (slightly sunken inward)
  const scaleAnim = useRef(new Animated.Value(isFocused ? 0.95 : 1)).current;

  // Tight spring for focus state — snaps in ~150ms
  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: isFocused ? 0.95 : 1,
      friction: 8,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [isFocused]);

  const label =
    options.tabBarLabel !== undefined
      ? options.tabBarLabel
      : options.title !== undefined
        ? options.title
        : route.name;

  const onPress = () => {
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });

    if (!isFocused && !event.defaultPrevented) {
      // Navigate immediately — don't block on animation
      navigation.navigate({ name: route.name, merge: true });

      // Quick tap feedback: compress → settle at sunken position
      Animated.sequence([
        Animated.spring(scaleAnim, {
          toValue: 0.88,
          friction: 10,
          tension: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 0.95,
          friction: 8,
          tension: 120,
          useNativeDriver: true,
        }),
      ]).start();
    }
  };

  const onLongPress = () => {
    navigation.emit({
      type: "tabLongPress",
      target: route.key,
    });
  };

  let iconName: any = "square";
  if (route.name === "Contacts") {
    iconName = isFocused ? "people" : "people-outline";
  } else if (route.name === "Calls") {
    iconName = isFocused ? "call" : "call-outline";
  } else if (route.name === "Add") {
    iconName = isFocused ? "person-add" : "person-add-outline";
  } else if (route.name === "Settings") {
    iconName = isFocused ? "settings" : "settings-outline";
  }

  return (
    <TouchableOpacity
      key={route.key}
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      accessibilityLabel={options.tabBarAccessibilityLabel}
      testID={options.tabBarTestID}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={1}
      style={[styles.tabCell, isFocused && styles.tabCellPressed]}
    >
      {/* Neumorphic pit effect — only rendered when focused */}
      {isFocused && (
        <>
          {/* Deep shadow layer: darkens the pit */}
          <View style={styles.pitBase} />
          {/* Inner top shadow: dark edge at top-left (light source = bottom-right for pit) */}
          <View style={styles.pitShadowTop} />
          {/* Inner bottom highlight: faint light leak at bottom-right */}
          <View style={styles.pitHighlightBottom} />
        </>
      )}

      <Animated.View
        style={[styles.tabContent, { transform: [{ scale: scaleAnim }] }]}
      >
        <Ionicons
          name={iconName}
          size={24}
          color={isFocused ? Theme.colors.accent : Theme.colors.textSecondary}
          style={isFocused ? styles.glowingIcon : undefined}
        />
        <Text
          style={[
            styles.tabLabel,
            isFocused ? styles.tabLabelActive : styles.tabLabelInactive,
          ]}
        >
          {label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

export function TabBar({ state, descriptors, navigation }: any) {
  return (
    // Outer wrapper provides the raised neu elevation + drop shadow
    <View style={styles.tabBarOuter}>
      {/* The actual bar surface — raised neumorphic platform */}
      <View style={styles.tabBar}>
        {state.routes.map((route: any, index: number) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;

          return (
            <TabItem
              key={route.key}
              route={route}
              index={index}
              isFocused={isFocused}
              options={options}
              navigation={navigation}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Outer wrapper: carries the heavy drop shadow so the bar "floats" off the screen
  tabBarOuter: {
    // iOS shadow — large upward cast to feel like a raised physical platform
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.7,
    shadowRadius: 20,
    // Android: elevation gives the raised platform look
    elevation: 24,
    backgroundColor: "transparent",
  },
  // Inner bar: the neumorphic surface with raised border treatment
  // Matches NeuCard convention — light top/left borders = surface faces the light source = appears raised
  tabBar: {
    flexDirection: "row",
    height: 68,
    // Slightly lighter than the screen background so the bar reads as a raised slab
    backgroundColor: "#001f35", // ~10% lighter than inkBlack2 (#001828)

    // ── Neumorphic raised surface borders (same system as NeuCard) ───────────
    // Top edge: bright highlight — light hits the top of the raised platform
    borderTopWidth: 1.5,
    borderTopColor: "rgba(255, 255, 255, 0.12)", // matches Theme.neu.shadowLight-ish
    // Bottom edge: invisible (platform sits flush on screen floor)
    borderBottomWidth: 0,
    // Left/right: slight light catch
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255, 255, 255, 0.06)",
    borderRightWidth: 1,
    borderRightColor: "rgba(0, 0, 0, 0.4)",
  },

  // ── Tab cell ─────────────────────────────────────────────────────────────
  tabCell: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    height: "100%",
    overflow: "hidden",
  },
  // When pressed: clip everything, the pit layers fill this cell
  tabCellPressed: {
    // No extra style needed — pit layers are absoluteFill inside
  },

  // ── Neumorphic Pit Layers (stacked absolute fills) ───────────────────────
  // Layer 1 — pit base: slightly darker than bar surface but with a blue tint
  // so the dark top/left shadow borders have clear contrast to pop against
  pitBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 20, 40, 0.8)", // blue-tinted pit floor — lighter than black so edges contrast
  },
  // Layer 2 — top/left dark shadow: simulates a deep overhang casting shadow
  // into the pit (reversed from NeuCard — dark top = concave, not convex)
  pitShadowTop: {
    ...StyleSheet.absoluteFillObject,
    // Only show the top and left shadow edges
    borderTopWidth: 3,
    borderLeftWidth: 2,
    borderTopColor: "rgba(0, 0, 0, 0.80)", // heavy dark edge at top
    borderLeftColor: "rgba(0, 0, 0, 0.60)", // dark edge left
    borderBottomWidth: 0,
    borderRightWidth: 0,
    borderBottomColor: "transparent",
    borderRightColor: "transparent",
  },
  // Layer 3 — bottom/right light leak: opposite edge gets faint ambient bounce
  pitHighlightBottom: {
    ...StyleSheet.absoluteFillObject,
    borderBottomWidth: 2,
    borderRightWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.10)", // faint light leak bottom
    borderRightColor: "rgba(255, 255, 255, 0.06)", // faint light leak right
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderTopColor: "transparent",
    borderLeftColor: "transparent",
  },

  // ── Icon + label content ──────────────────────────────────────────────────
  tabContent: {
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    height: "100%",
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: "600",
    marginTop: 4,
  },
  tabLabelActive: {
    color: Theme.colors.textPrimary,
  },
  tabLabelInactive: {
    color: Theme.colors.textSecondary,
  },
  // Strong blue glow on selected icon stroke (full opacity, wide radius)
  glowingIcon: {
    textShadowColor: "rgba(1, 83, 141, 1.0)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
});
