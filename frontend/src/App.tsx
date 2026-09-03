import { RouterProvider } from "react-router";
import { router } from "./routes";
import { AuthProvider } from "./context/AuthContext";
import { VacancyDataProvider } from "./context/VacancyDataContext";

export default function App() {
  return (
    <VacancyDataProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </VacancyDataProvider>
  );
}
