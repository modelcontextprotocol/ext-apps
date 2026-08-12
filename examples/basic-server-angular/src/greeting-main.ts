import "@angular/compiler";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideZonelessChangeDetection } from "@angular/core";
import { GreetingComponent } from "./greeting.component";
import "./global.css";

bootstrapApplication(GreetingComponent, {
  providers: [provideZonelessChangeDetection()],
}).catch((err) => console.error(err));
