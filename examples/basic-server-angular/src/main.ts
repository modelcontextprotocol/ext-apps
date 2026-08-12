import "@angular/compiler";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideZonelessChangeDetection } from "@angular/core";
import { AppComponent } from "./app.component";
import "./global.css";

bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection()],
}).catch((err) => console.error(err));
