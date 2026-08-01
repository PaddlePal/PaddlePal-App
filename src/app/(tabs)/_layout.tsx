import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/spacing';
import { TourOverlay } from '@/components/tour/TourOverlay';
import { TourProvider } from '@/hooks/useTour';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    // The tour runs on the real tabs: TourOverlay is the last child, sitting on
    // top of <Tabs> so it can spotlight what's actually on screen.
    <TourProvider>
      <View style={styles.root}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: Colors.primary,
            tabBarInactiveTintColor: Colors.muted,
            tabBarLabelStyle: styles.tabLabel,
            tabBarItemStyle: styles.tabItem,
            tabBarStyle: [styles.tabBar, { bottom: insets.bottom + 12 }],
          }}
        >
          <Tabs.Screen
            name="dashboard"
            options={{
              title: 'Dashboard',
              tabBarLabel: 'Home',
              tabBarIcon: ({ color, focused }) => (
                <SymbolView
                  name={focused ? 'house.fill' : 'house'}
                  tintColor={color}
                  size={24}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="live"
            options={{
              title: 'Live',
              tabBarLabel: 'Live',
              tabBarIcon: ({ color }) => (
                <SymbolView
                  name="waveform.path.ecg"
                  tintColor={color}
                  size={24}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="sessions"
            options={{
              title: 'History',
              tabBarLabel: 'History',
              tabBarIcon: ({ color }) => (
                <SymbolView
                  name="clock.arrow.circlepath"
                  tintColor={color}
                  size={24}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: 'Settings',
              tabBarLabel: 'Settings',
              tabBarIcon: ({ color, focused }) => (
                <SymbolView
                  name={focused ? 'gearshape.fill' : 'gearshape'}
                  tintColor={color}
                  size={24}
                />
              ),
            }}
          />
        </Tabs>

        <TourOverlay />
      </View>
    </TourProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  // Floating, translucent "liquid glass"-ish pill.
  tabBar: {
    position: 'absolute',
    left: 24,
    right: 24,
    height: 64,
    paddingTop: 6,
    paddingBottom: 14,
    borderRadius: Radius.full,
    backgroundColor: Colors.glassBackground,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    borderTopColor: Colors.glassBorder,
    // Lift it off the content so it reads as floating.
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  tabItem: {
    paddingTop: 0,
  },
  tabLabel: {
    ...Typography.labelCaps,
    fontSize: 10,
  },
});
