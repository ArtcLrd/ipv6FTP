import React from "react";
import {
  TouchableOpacity,
  Text,
  View,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacityProps,
} from "react-native";
import { BlurView } from "expo-blur";
import { Theme } from "../theme";
import { BrandColors } from "../theme/colors";
import { cn } from "../utils";

interface GlassButtonProps extends TouchableOpacityProps {
  title: string;
  variant?: "primary" | "secondary" | "destructive";
  loading?: boolean;
  rightIcon?: React.ReactNode;
}

export function GlassButton({
  title,
  variant = "primary",
  loading,
  disabled,
  rightIcon,
  style,
  ...props
}: GlassButtonProps) {
  const isButtonDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={cn(
        styles.button,
        styles[variant],
        isButtonDisabled && styles.disabled,
        style,
      )}
      disabled={isButtonDisabled}
      activeOpacity={0.78}
      {...props}
    >
      {variant === "secondary" && (
        <BlurView
          intensity={40}
          tint="dark"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: Theme.roundness.pill },
          ]}
        />
      )}
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === "secondary" ? "#ffffff" : "#ffffff"}
        />
      ) : (
        <View style={styles.contentRow}>
          <Text
            style={cn(
              styles.text,
              styles[`text_${variant}` as keyof typeof styles],
            )}
          >
            {title}
          </Text>
          {rightIcon && <View style={styles.iconContainer}>{rightIcon}</View>}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: Theme.roundness.pill,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Theme.spacing.lg,
    flexDirection: "row",
    width: "100%",
    marginVertical: Theme.spacing.xs,
    // Neumorphic extrusion
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    borderTopColor: "rgba(255, 255, 255, 0.35)",
    borderLeftColor: "rgba(255, 255, 255, 0.20)",
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomColor: "rgba(0, 0, 0, 0.9)",
    borderRightColor: "rgba(0, 0, 0, 0.7)",
  },
  primary: {
    backgroundColor: BrandColors.balticBlue,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 8,
  },
  secondary: {
    backgroundColor: "rgba(1, 83, 141, 0.10)",
    // Override borders for secondary to be more subtle but still extruded
    borderTopColor: "rgba(255, 255, 255, 0.15)",
    borderLeftColor: "rgba(255, 255, 255, 0.08)",
    borderBottomColor: "rgba(0, 0, 0, 0.6)",
    borderRightColor: "rgba(0, 0, 0, 0.4)",
  },
  destructive: {
    backgroundColor: Theme.colors.danger,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation:8,
  },
  disabled: {
    opacity: 0.4,
  },
  text: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  text_primary: {
    color: "#ffffff",
  },
  text_secondary: {
    color: "rgba(255,255,255,0.80)",
  },
  text_destructive: {
    color: "#ffffff",
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    marginLeft: 8,
  },
});
