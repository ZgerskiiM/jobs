import { createBrowserRouter } from "react-router";
import Root from "./pages/Root";
import Home from "./pages/Home";
import Trends from "./pages/Trends";
import Profile from "./pages/Profile";
import Activity from "./pages/Activity";
import JobDetail from "./pages/JobDetail";
import CompanyPage from "./pages/CompanyPage";
import Companies from "./pages/Companies";
import Admin from "./pages/Admin";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: Home },
      { path: "trends", Component: Trends },
      { path: "companies", Component: Companies },
      { path: "profile", Component: Profile },
      { path: "activity", Component: Activity },
      { path: "jobs/:id", Component: JobDetail },
      { path: "companies/:id", Component: CompanyPage },
      { path: "admin", Component: Admin },
    ],
  },
]);
