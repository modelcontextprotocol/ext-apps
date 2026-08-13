import { Component, DestroyRef, inject, signal } from '@angular/core';
import { getTheme, onThemeChange, toggleTheme, type Theme } from '../../theme';

@Component({
  selector: 'app-theme-toggle',
  templateUrl: './theme-toggle.html',
  styleUrl: './theme-toggle.scss',
})
export class ThemeToggle {
  theme = signal<Theme>(getTheme());

  constructor() {
    inject(DestroyRef).onDestroy(onThemeChange((t) => this.theme.set(t)));
  }

  toggle(): void {
    toggleTheme();
  }
}
