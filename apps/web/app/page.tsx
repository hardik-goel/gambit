import { shelfEntries } from "@gambit/games";
import { Lobby } from "./Lobby";

export default function HomePage() {
  // The shelf is derived from the installed games — adding a package adds a box.
  return <Lobby games={shelfEntries()} />;
}
