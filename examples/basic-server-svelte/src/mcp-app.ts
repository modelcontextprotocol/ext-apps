import { mount } from "svelte";
import App from "./App.svelte";
import "./global.css";

mount(App, { target: document.getElementById("app")! });
