import React, { useState } from "react";
import {
  TextInput,
  TextInputProps,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Animated,
} from "react-native";
import { Theme } from "../theme";
import { BrandColors } from "../theme/colors";
import { cn } from "../utils";
import { Ionicons } from "@expo/vector-icons";

interface GlassInputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export function GlassInput({
  label,
  error,
  style,
  onFocus,
  onBlur,
  secureTextEntry,
  ...props
}: GlassInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isSecure, setIsSecure] = useState(true);

  return (
    <View style={styles.container}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View
        style={cn(
          styles.inputWrapper,
          isFocused && styles.inputWrapperFocused,
          !!error && styles.inputWrapperError,
          style,
        )}
      >
        <TextInput
          style={styles.input}
          placeholderTextColor="rgba(255,255,255,0.35)"
          selectionColor={BrandColors.balticBlue}
          secureTextEntry={secureTextEntry ? isSecure : false}
          onFocus={(e) => {
            setIsFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            onBlur?.(e);
          }}
          {...props}
        />
        {secureTextEntry && (
          <TouchableOpacity
            onPress={() => setIsSecure(!isSecure)}
            style={styles.iconButton}
            activeOpacity={0.7}
          >
            <Ionicons
              name={isSecure ? "eye-off-outline" : "eye-outline"}
              size={20}
              color="rgba(255,255,255,0.40)"
            />
          </TouchableOpacity>
        )}
      </View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Theme.spacing.md,
    width: "100%",
  },
  label: {
    fontSize: 13,
    color: Theme.colors.textSecondary,
    marginBottom: Theme.spacing.xs,
    fontWeight: "500",
    letterSpacing: 0.2,
  },
  inputWrapper: {
    height: 52,
    backgroundColor: "rgba(0, 24, 40, 0.55)", // inkBlack2 tinted glass
    // Neumorphic extrusion
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.12)",
    borderLeftColor: "rgba(255, 255, 255, 0.08)",
    borderBottomWidth: 1.5,
    borderRightWidth: 1.5,
    borderBottomColor: "rgba(0, 0, 0, 0.8)",
    borderRightColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: Theme.roundness.pill, // pill shape matching buttons
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    // Outer shadow for pop out
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation:8,
  },
  inputWrapperFocused: {
    // On focus, give it a glowing ring and slightly pressed look
    borderTopColor: BrandColors.balticBlue,
    borderLeftColor: BrandColors.balticBlue,
    borderBottomColor: "rgba(1, 83, 141, 0.4)",
    borderRightColor: "rgba(1, 83, 141, 0.4)",
    backgroundColor: "rgba(0, 24, 40, 0.80)",
    // Focus glow
    shadowColor: BrandColors.balticBlue,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation:8,
  },
  inputWrapperError: {
    borderColor: Theme.colors.danger,
  },
  input: {
    flex: 1,
    height: "100%",
    color: "#ffffff",
    fontSize: 16,
    padding: 0,
  },
  iconButton: {
    paddingLeft: Theme.spacing.sm,
    justifyContent: "center",
    alignItems: "center",
    height: "100%",
  },
  errorText: {
    fontSize: 12,
    color: Theme.colors.danger,
    marginTop: Theme.spacing.xs,
  },
});
