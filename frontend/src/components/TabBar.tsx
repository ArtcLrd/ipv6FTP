import React, { useRef, useEffect } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Text,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Theme } from "../theme";

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

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
  // Unselected = 1.0 (flat/neutral). Selected = 1.1 (pops out)
  const scaleAnim = useRef(new Animated.Value(isFocused ? 1.1 : 1)).current;

  // Tight spring for focus state
  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: isFocused ? 1.1 : 1,
      friction: 6,
      tension: 100,
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

      // Quick tap feedback: compress slightly → settle at popped position
      Animated.sequence([
        Animated.spring(scaleAnim, {
          toValue: 0.95,
          friction: 10,
          tension: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1.1,
          friction: 6,
          tension: 100,
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

  let iconName: any = "square-outline";
  if (route.name === "Contacts") {
    iconName = "people-outline";
  } else if (route.name === "Calls") {
    iconName = "call-outline";
  } else if (route.name === "Add") {
    iconName = "person-add-outline";
  } else if (route.name === "Settings") {
    iconName = "settings-outline";
  }

  return (
    <AnimatedTouchableOpacity
      key={route.key}
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      accessibilityLabel={options.tabBarAccessibilityLabel}
      testID={options.tabBarTestID}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={1}
      style={[
        styles.tabCell, 
        isFocused ? styles.tabCellPressed : styles.tabCellInactive,
        { 
          transform: [{ scale: scaleAnim }], 
          zIndex: isFocused ? 1 : 0 
        }
      ]}
    >
      <View style={styles.tabContent}>
        <Ionicons
          name={iconName}
          size={24}
          color={isFocused ? "#ffffff" : Theme.colors.textSecondary}
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
      </View>
    </AnimatedTouchableOpacity>
  );
}

export function TabBar({ state, descriptors, navigation }: any) {
  const insets = useSafeAreaInsets();

  return (
    // Outer wrapper provides the raised neu elevation + drop shadow
    <View style={[styles.tabBarOuter, { paddingBottom: Math.max(insets.bottom, 10) }]}>
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
    shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    // Android: elevation gives the raised platform look
    elevation: 24,
    backgroundColor: "transparent",
  },
  // Inner bar: the neumorphic surface with raised border treatment
  tabBar: {
    flexDirection: "row",
    height: 72,
    backgroundColor: "transparent", // transparent background
    borderTopWidth: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    paddingTop: 0,
    paddingHorizontal: 4,
    paddingBottom: 12, // breathing room at the bottom for grid row
    gap: 2, // reduced gap between cells to stick together
  },

  // ── Tab cell (Chocolate bar style grid cells) ────────────────────────
  tabCell: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    height: "100%",
    borderRadius: 8,
    // Add border to define the grid cells (groove)
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.4)",
  },
  tabCellInactive: {
    backgroundColor: "rgba(0, 24, 40, 0.4)", // darker inset for inactive
    borderTopColor: "rgba(255, 255, 255, 0.05)",
    borderLeftColor: "rgba(255, 255, 255, 0.05)",
    opacity: 0.85, // little dimmed
  },
  tabCellPressed: {
    backgroundColor: "rgba(0, 30, 50, 0.8)", // slightly lighter convex pop out
    borderTopColor: "rgba(255, 255, 255, 0.15)",
    borderLeftColor: "rgba(255, 255, 255, 0.10)",
    borderColor: "rgba(0, 0, 0, 0.6)",
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
  // Strong white glow on selected icon stroke (full opacity, tight radius)
  glowingIcon: {
    textShadowColor: "rgba(255, 255, 255, 1.0)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },
});
