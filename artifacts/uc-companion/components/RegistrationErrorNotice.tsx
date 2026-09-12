import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface RegistrationErrorNoticeProps {
  message: string;
  hint?: string;
  primaryColor: string;
  cardColor: string;
  onForgotPassword: () => void;
}

export function RegistrationErrorNotice({
  message,
  hint,
  primaryColor,
  cardColor,
  onForgotPassword,
}: RegistrationErrorNoticeProps) {
  return (
    <View style={[styles.errorBox, { backgroundColor: cardColor, borderColor: '#EF4444' }]}>
      <Ionicons name="alert-circle-outline" size={16} color="#EF4444" style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.errorMsg}>{message}</Text>
        {hint === 'forgot_password' && (
          <TouchableOpacity
            onPress={onForgotPassword}
            style={styles.forgotBtn}
            testID="register-forgot-password"
          >
            <Text style={[styles.forgotBtnText, { color: primaryColor }]}>Forgot password?</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export default RegistrationErrorNotice;

const styles = {
  errorBox: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  errorMsg: { fontSize: 13, color: '#EF4444', lineHeight: 18 },
  forgotBtn: { marginTop: 6 },
  forgotBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    textDecorationLine: 'underline' as const,
  },
};