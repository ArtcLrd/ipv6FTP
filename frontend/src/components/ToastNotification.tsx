import React, { Component } from 'react';
import { StyleSheet, Text, Animated } from 'react-native';

interface ToastState {
  visible: boolean;
  message: string;
}

let toastInstance: any = null;

export class ToastNotification extends Component<{}, ToastState> {
  state: ToastState = {
    visible: false,
    message: '',
  };

  private fadeAnim = new Animated.Value(0);
  private slideAnim = new Animated.Value(50);
  private timer: any = null;

  componentDidMount() {
    toastInstance = this;
  }

  componentWillUnmount() {
    if (toastInstance === this) {
      toastInstance = null;
    }
    if (this.timer) clearTimeout(this.timer);
  }

  show(message: string, duration = 3000) {
    if (this.timer) clearTimeout(this.timer);

    this.setState({ visible: true, message }, () => {
      Animated.parallel([
        Animated.timing(this.fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(this.slideAnim, {
          toValue: 0,
          tension: 80,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();

      this.timer = setTimeout(() => {
        this.hide();
      }, duration);
    });
  }

  hide() {
    Animated.parallel([
      Animated.timing(this.fadeAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(this.slideAnim, {
        toValue: 50,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      this.setState({ visible: false, message: '' });
    });
  }

  static show(message: string, duration = 3000) {
    if (toastInstance) {
      toastInstance.show(message, duration);
    } else {
      console.warn('ToastNotification is not mounted. Message:', message);
    }
  }

  render() {
    if (!this.state.visible) return null;

    return (
      <Animated.View
        style={[
          styles.container,
          {
            opacity: this.fadeAnim,
            transform: [{ translateY: this.slideAnim }],
          },
        ]}
      >
        <Text style={styles.text}>{this.state.message}</Text>
      </Animated.View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80,
    left: 16,
    right: 16,
    backgroundColor: '#0c1b24',
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(1, 83, 141, 0.4)',
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    borderLeftColor: 'rgba(255, 255, 255, 0.06)',
    borderBottomColor: 'rgba(0, 0, 0, 0.55)',
    borderRightColor: 'rgba(0, 0, 0, 0.45)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 9999,
  },
  text: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
});
